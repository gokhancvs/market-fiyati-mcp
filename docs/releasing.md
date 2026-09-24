# Sürüm hazırlama

**Yeni kararlı tag push’u npm ve GitHub yayınını otomatik başlatır.** Bu rehber kaynak depo klonu içindir.
Tek geliştirme dalı `main`; tag biçimi `vX.Y.Z`. Patch = düzeltme, minor = geriye uyumlu özellik,
major = uyumsuz sözleşme. Yayımlanmış tag ve npm sürümü değiştirilmez.

## 1. Bir kez npm bağlantısını kurun

npm paketinin **Settings → Trusted publishing → GitHub Actions** bölümünde:

| Alan                             | Değer                       |
| -------------------------------- | --------------------------- |
| Organization or user             | `gokhancvs`                 |
| Repository                       | `market-fiyati-mcp`         |
| Workflow filename                | `release.yml`               |
| Environment                      | Boş bırakın                 |
| Allowed actions (gösteriliyorsa) | Doğrudan `npm publish` izni |

CLI alternatifi npm 11.15+ gerektirir (gerekirse tarayıcıda hesap/2FA doğrulamasını tamamlayın):

```sh
npm trust github market-fiyati-mcp --repository gokhancvs/market-fiyati-mcp --file release.yml --allow-publish
```

GitHub Actions, npm'e OIDC ile bağlanır; `NPM_TOKEN` secret'ı veya her sürümde manuel
2FA gerekmez. Workflow GitHub-hosted Ubuntu, Node 24 ve npm'in OIDC destekli sürümünü kullanır
(npm 11.5.1+, Node 22.14+). [npm Trusted Publisher rehberi](https://docs.npmjs.com/trusted-publishers/).
Bağlantı kurulmadan tag göndermek npm adımını başarısız yapar; kurulumu tamamlayıp aynı Actions çalışmasını yeniden çalıştırın.

## 2. Sürümü hazırlayın

`1.0.1` npm'de yayımlandı. Kaldırılmış `1.0.0` ve kullanılmış diğer sürümler yeniden kullanılamaz.
Aşağıdaki `1.0.2` yalnız bir sonraki patch örneğidir; her yayında yeni sürüm seçin.

1. `npm version 1.0.2 --no-git-tag-version` ile paket ve lockfile sürümlerini birlikte güncelleyin.
   `src/server.ts` içindeki MCP kimliğini aynı sürüme getirin.
2. README'deki sabit `npx` sürümünü, CHANGELOG'u ve `docs/releases/v1.0.2.md` notunu hazırlayın.
   Notlar kurulum, değişiklik ve doğrulama sınırlarını içersin; sentetik testi canlı başarı olarak göstermeyin.
3. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.
4. Conventional Commit oluşturup `main`'i push'layın.

## 3. Tag’i gönderin

Test edilen commit üzerinde:

```sh
git fetch origin main
git tag -a v1.0.2 -m "Release v1.0.2"
npm run release:check -- v1.0.2
git push origin v1.0.2
```

Yerel RTK kuralı varsa komutların başına `rtk` ekleyin.
Tag’ler bir dala push edilmez; workflow tag commit’inin `origin/main` geçmişinde olduğunu doğrular.
Main daha sonra ilerlese de tag’in işaret ettiği commit test edilir ve paketlenir.

**Tag push’u yayın onayıdır:** ek Run workflow veya Publish release tıklaması yoktur.
`v*` tetikleyicisinin ardından sürüm doğrulayıcısı yalnız kararlı `vX.Y.Z` biçimini kabul eder.
Ön sürüm, sürüm uyuşmazlığı veya main dışında commit yayını durdurur.

## 4. Otomatik akış ve başarı işareti

1. Tag/commit, main geçmişi, paket/lockfile sürümü ve sürüm notları doğrulanır.
2. Mevcut Ubuntu Node 22/24 ve macOS Node 24 kontrolleri ile üretim bağımlılığı denetimi geçer.
3. Yayın işi temiz kurulumla offline kontrolleri tekrar çalıştırır. Paket testi arşiv içeriğini,
   kurulu CLI yardımını, stdio bağlantısını ve offline durumunu doğrular; başarılı arşiv korunur.
4. **Aynı test edilmiş arşiv** npmjs.com'a public/latest olarak OIDC ile gönderilir.
   Registry sürüm ve SHA-512 integrity değerleri eşleşmeden sonraki adıma geçilmez.
5. GitHub Release sürüm notlarıyla oluşturulur; test edilmiş `.tgz` eklenir.

**Başarı:** GitHub Actions → Publish release yeşil; npm sürümü/integrity doğru;
GitHub Release ve arşiv görünür. GitHub Packages'a yayın yapılmaz; repo Packages kutusunun boş kalması normaldir.
Market Fiyatı API'si tüm akış boyunca offline'dır. npm kurulum/yayın ve advisory istekleri bu kısıta dahil değildir.

Akış yarıda kalırsa **Re-run failed jobs** kullanın. npm sürümü zaten varsa yalnız arşiv integrity’si
aynı olduğunda yayın atlanır; farklı içerik veya kaldırılmış hedef sürüm açık hata verir.
Mevcut GitHub Release yeniden oluşturulmaz. Tag taşımayın ve aynı sürümü farklı içerikle paketlemeyin.
Yeni sürüm npm `latest` değerinden büyük olmalıdır; geç gelen eski tag `latest` değerini geriye çekemez.
Yayınlar sırayla çalışır; GitHub kuyruğu en fazla 100 bekleyen yayını tutar.

## Yerel paket provası

```sh
npm pack
npm install /mutlak/yol/market-fiyati-mcp-1.0.2.tgz --ignore-scripts
npm publish /mutlak/yol/market-fiyati-mcp-1.0.2.tgz --dry-run --access public
```

Kurulumu ayrı geçici dizinde yapın; CLI/MCP doğrulaması offline kalsın.
Dry-run yayın yetkisini veya uzak API davranışını kanıtlamaz.
Otomatik paket testi geliştirme/test dosyalarını dışlar ve bağımlılık indirmeden arşivi sınar.

## Bakım

Her main push’unda platform matrisi ve bağımlılık denetimi çalışır. Pazartesi 07:00 UTC
zamanlaması yalnız üretim bağımlılıklarını denetler; GitHub zamanlaması gecikebilir.
`npm audit --omit=dev` geliştirme bağımlılıklarını kapsamaz. Bağımlılıkları elle ve sabit sürümle güncelleyin.
Token, kişisel koordinat veya ham tanılamayı Git'e ya da issue'ya eklemeyin.
