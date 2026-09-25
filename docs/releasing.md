# Sürüm çıkarma

**Önce kapsamı belirleyin:** Hazırlık, merge, tag veya MCP Registry yayını?
Yalnız istenen aşamaları tamamlayın; verilmiş onayı yeniden istemeyin.

**Yeni kararlı tag’i push etmek npm ve GitHub yayınını başlatır.** Kod düzenleme isteği yayın yetkisi değildir.

## 1. Sürümü hazırlayın

```sh
npm version 1.0.6 --no-git-tag-version
```

`1.0.6` örnektir; yayımlanmış/kaldırılmış sürümü tekrar kullanmayın.
Patch düzeltme, minor geriye uyumlu özellik, major uyumsuz sözleşme içindir.

| Eşitleyin           | Dosyalar                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Paket ve sunucu     | `package.json`, `package-lock.json`, `src/server.ts`                                          |
| Kurulum ve manifest | README, `examples/mcp-config.json`, `docs/live-testing.md`, `server.json` üst ve paket sürümü |
| Sürüm açıklaması    | CHANGELOG, `docs/releases/v1.0.6.md`                                                          |
| Paket içeriği       | Yeni sürüm notunu `package.json` files ve paket testinin belge listesine ekleyin.             |

## 2. Kontrol edin ve PR ile merge edin

```sh
MARKET_FIYATI_MODE=offline npm run check
npm run test:consumer
```

1. Son diff’i ve staged dosyaları inceleyin; plan/rapor/özel verileri dahil etmeyin.
2. Conventional Commit oluşturup feature branch’ini push edin; PR açın.
3. Tüm gerekli CI kontrollerini bekleyip PR’ı `main`’e merge edin.
4. Merge commit’ini doğrulayın; temiz yerel main’i fast-forward güncelleyin.

Doğrudan main push, force-push ve main silme kapalıdır. İlgisiz yerel değişiklikleri koruyun.

## 3. Tag’i gönderin

**Yalnız yayın yetkisi varsa**, doğrulanmış main commit’inde çalıştırın:

```sh
git fetch origin main
git tag -a v1.0.6 -m "Release v1.0.6"
npm run release:check -- v1.0.6
git push origin v1.0.6
```

RTK zorunluysa komutları onunla çalıştırın. Tag’i taşımayın; yayımlanan içeriği değiştirmeyin.
Workflow yalnız kararlı `vX.Y.Z`, eşleşen paket sürümü ve `origin/main` geçmişindeki commit’i kabul eder.
Main ilerlese de paketlenen tag commit’idir. Ek “Publish” düğmesine gerek yoktur.

## 4. Yayını doğrulayın

| Kontrol           | Başarı ölçütü                                                    |
| ----------------- | ---------------------------------------------------------------- |
| GitHub Actions    | “Publish release” yeşil                                          |
| npm               | Sürüm, SHA-512 integrity ve yeni yayın için `latest` doğru       |
| GitHub Release    | Sürüm açıklaması ve test edilen `.tgz` görünür                   |
| Anahtar kelimeler | `package.json` keywords, npm keywords ve GitHub Topics aynı küme |
| MCP Registry      | Yalnız ayrıca yayımlandıysa ad/sürüm registry’den doğrulanmış    |

Release açıklamasındaki hazırlık ifadelerini güncelleyin; belge linklerini yayımlanan tag’e sabitleyin.
**Tag push tek başına başarı değildir.** npm ve MCP Registry durumunu ayrı raporlayın.
GitHub Packages kullanılmaz; Packages bölümünün boş olması normaldir.

## 5. Branch’leri temizleyin

- `delete_branch_on_merge=true` kalsın; merge edilen remote branch’in silindiğini doğrulayın.
- Kaldıysa başında yeni iş olmadığını kontrol edip yalnız tam entegre branch’i silin.
- Yerel branch/worktree yalnız temiz, kullanılmayan ve entegre durumdaysa kaldırılır.
- Önce ignored `plans/` ve `reports/` arşivlerini dışarı yedekleyin; zorla temizlik yapmayın.
- Commit/PR/release linklerini, doğrulama sonucunu ve kalan işlemi teslimde belirtin.

<details>
<summary>İlk yayın: npm Trusted Publishing kurulumu</summary>

npm paketinin **Settings → Trusted publishing → GitHub Actions** alanını doldurun:

| Alan                      | Değer                             |
| ------------------------- | --------------------------------- |
| Organization / Repository | `gokhancvs` / `market-fiyati-mcp` |
| Workflow                  | `release.yml`                     |
| Environment               | Boş                               |
| Allowed actions           | `npm publish`                     |

npm 11.15+ ile CLI alternatifi:

```sh
npm trust github market-fiyati-mcp --repository gokhancvs/market-fiyati-mcp --file release.yml --allow-publish
```

Gerekirse hesap/2FA adımını tarayıcıda tamamlayın. Actions OIDC kullanır; `NPM_TOKEN` gerekmez.
Workflow GitHub-hosted Ubuntu, Node 24 ve OIDC uyumlu npm kullanır (npm 11.5.1+, Node 22.14+).
Kurulum eksikse publish başarısız olur; kurduktan sonra aynı çalışmanın başarısız işlerini yeniden başlatın.
[npm rehberi](https://docs.npmjs.com/trusted-publishers/).

</details>

<details>
<summary>Otomatik akış ve başarısız yayını sürdürme</summary>

1. Tag/main ilişkisi, sürümler ve notlar doğrulanır.
2. Ubuntu Node 22/24, macOS Node 24 kontrolleri; üretim bağımlılık denetimi ve
   Ubuntu Node 22 / Windows Node 24 tüketici kurulumu geçer.
3. Yayın işi offline kontrolleri tekrarlar. Aynı arşiv ayrı cache/dizinde üretim bağımlılıklarıyla kurulur;
   npm binary’si ağ engeliyle sınanır.
4. Test edilmiş arşiv OIDC ile npm’e public/latest gönderilir; sürüm, integrity ve latest doğrulanır.
5. GitHub Release ve `.tgz` oluşturulur.

Yarıda kalırsa **Re-run failed jobs** kullanın. Doğrulama geçici bağlantı/429/502/503/504 hatalarını
tekrarlar; **publish tekrarlanmaz**. Bozuk JSON veya integrity farkı hemen durdurur.
HTTP süreleri dâhil toplam sınır 5 dakika ve en fazla 61 okumadır. Normal bekleme 5 saniyedir;
Retry-After daha uzunsa erken istek yapılmaz, süreye sığmazsa hata verilir.

npm sürümü zaten varsa yalnız aynı integrity ile atlanır. Tarihsel doğrulamada latest aynı veya
daha yeni kararlı sürüm olabilir; eski/eksik latest sınırlı süre okunur, otomatik değiştirilmez.
Kaldırılmış sürüm veya farklı içerik hata verir. Mevcut GitHub Release yeniden oluşturulmaz.
Yeni yayın latest’ten büyük olmalıdır; eski tag latest’i geri çekemez. Yayınlar sıralıdır; kuyruk en fazla 100’dür.

Market Fiyatı API’si offline kalır. npm kurulum/yayın/advisory istekleri bu kısıtın dışındadır.

</details>

<details>
<summary>Yerel paket kontrolü ve bakım</summary>

```sh
npm pack
npm run test:consumer
npm publish /mutlak/yol/market-fiyati-mcp-1.0.6.tgz --dry-run --access public
```

Hazır arşiv: `npm run test:consumer -- /mutlak/yol/pack.json`.
Hazır kurulum: `npm run test:installed -- /mutlak/yol/kurulum`.
Dry-run yayın yetkisini veya live API’yi kanıtlamaz. Paket testleri geliştirme/test dosyalarını dışlar;
normal paket testi bağımlılık indirmez, tüketici kurulumu npm ağı kullanabilir.

Her main push’unda CI/bağımlılık denetimi; pazartesi 07:00 UTC’de yalnız üretim bağımlılığı denetimi
çalışır. Zamanlanmış işler gecikebilir. `npm audit --omit=dev` geliştirme bağımlılıklarını kapsamaz.
Dependabot yalnız güvenlik güncellemeleri için açık; otomatik merge yoktur.
Bağımlılıkları sabit sürüm, tutarlı lockfile ve offline kontrollerle güncelleyin.
[Güvenlik bildirimi](../SECURITY.md) özel kanaldandır; token/koordinat/ham tanılama Git’e veya issue’ya girmez.

Yeni CI işleri ilk uzak çalışmada görüldükten sonra gerçek adlarını main’in gerekli kontrollerine ekleyin.
İş tanımı tek başına platform başarısı değildir.

</details>

<details>
<summary>Ayrı aşama: MCP Registry yayını</summary>

`server.json` hazırlıktır; npm yayını otomatik katalog kaydı oluşturmaz.
Paket `mcpName` ile manifest `name`, üst `version` ile `packages[].version` eşleşmelidir.
1.0.4 yeni metadata’yı içermez; eski sürümü yeniden yayımlamayın.

1. Önce npm yayınını doğrulayın.
2. [Resmî Registry rehberini](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
   izleyip manifesti belirtilen JSON şemasıyla doğrulayın.
3. Yetkilendirilmiş katalog yayını için GitHub girişi ve `mcp-publisher publish` çalıştırın.
4. Registry’de ad/sürümü doğrulayın.

Publisher destekliyorsa `mcp-publisher validate` kullanın. 1.8.1 yardımında görünmesine rağmen komut
çalışmayabilir; JSON Schema kontrolü yalnız yerel yapıyı kanıtlar, sahiplik veya yayın kabulünü değil.

</details>
