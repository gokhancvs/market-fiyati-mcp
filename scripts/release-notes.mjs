import assert from 'node:assert/strict';

// A dated CHANGELOG section becomes the GitHub Release body, so its links must work outside the repository.
const repositoryRef =
  /^https:\/\/(?:github\.com\/gokhancvs\/market-fiyati-mcp\/(?:blob|tree|raw)|raw\.githubusercontent\.com\/gokhancvs\/market-fiyati-mcp)\/([^/?#]+)/;

export function changelogSections(changelog) {
  const sections = [];
  let fenced = false;
  for (const line of changelog.split(/\r?\n/)) {
    if (line.startsWith('```')) fenced = !fenced;
    if (!fenced && line.startsWith('## ')) sections.push({ heading: line.slice(3), lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  return sections.map(({ heading, lines }) => ({
    heading,
    version: heading.match(/^(\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/)?.[1] ?? null,
    body: lines.join('\n').trim()
  }));
}

// Repository file links must be pinned to `tag`; without a tag (unreleased) any version tag is accepted.
export function linkProblems(body, tag) {
  const hrefs = [...body.matchAll(/\]\(([^)\s]+)\)|^ {0,3}\[[^\]]+\]:\s*(\S+)/gm)].map(
    ([, inline, reference]) => inline ?? reference
  );
  return hrefs.filter((href) => {
    if (!href.startsWith('https://')) return true;
    const ref = href.match(repositoryRef)?.[1];
    return ref !== undefined && (tag ? ref !== tag : !/^v\d+\.\d+\.\d+$/.test(ref));
  });
}

export function releaseNotes(changelog, version) {
  const sections = changelogSections(changelog);
  const section = sections.find((candidate) => candidate.version === version);
  assert.ok(section, 'Release version needs a dated changelog section');
  assert.ok(
    !sections.some(({ heading }) => heading === `Yayımlanmamış — ${version}`),
    'Release version cannot be unpublished'
  );
  assert.ok(section.body, 'Cannot use empty release notes');
  assert.deepEqual(
    linkProblems(section.body, `v${version}`),
    [],
    'Release notes need absolute links pinned to their tag'
  );
  return `${section.body}\n`;
}
