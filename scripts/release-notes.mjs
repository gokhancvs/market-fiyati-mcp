import assert from 'node:assert/strict';

// A dated CHANGELOG section becomes the GitHub Release body, so its links must work outside the repository.
const repositoryBlob = 'https://github.com/gokhancvs/market-fiyati-mcp/blob/';

export function changelogSections(changelog) {
  const sections = [];
  for (const line of changelog.split(/\r?\n/)) {
    if (line.startsWith('## ')) sections.push({ heading: line.slice(3), lines: [] });
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
  const pinned = (href) => {
    const ref = href.slice(repositoryBlob.length).split('/')[0];
    return tag ? ref === tag : /^v\d+\.\d+\.\d+$/.test(ref);
  };
  return [...body.matchAll(/\]\(([^)\s]+)\)/g)]
    .map(([, href]) => href)
    .filter((href) => !href.startsWith('https://') || (href.startsWith(repositoryBlob) && !pinned(href)));
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
