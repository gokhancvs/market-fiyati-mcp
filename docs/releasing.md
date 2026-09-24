# Sürüm hazırlama

**Yeni bir kararlı sürüm tag'ini push etmek, npm ve GitHub yayınını otomatik olarak başlatır.** Bu rehber
kaynak deponun klonunda çalışanlar içindir.

Tek geliştirme branch'i `main`'dir. Tag biçimi `vX.Y.Z` şeklindedir. Patch sürümü hata düzeltmesi, minor
sürümü geriye uyumlu yeni özellik, major sürümü uyumsuz bir sözleşme değişikliği içerir. Yayımlanmış bir tag
veya npm sürümü sonradan değiştirilmez.

## 1. npm bağlantısını bir kez kurma

npm paketinin **Settings → Trusted publishing → GitHub Actions** bölümüne şu değerleri girin:

| Alan                             | Değer                       |
| -------------------------------- | --------------------------- |
| Organization or user             | `gokhancvs`                 |
| Repository                       | `market-fiyati-mcp`         |
| Workflow filename                | `release.yml`               |
| Environment                      | Boş bırakın                 |
| Allowed actions (gösteriliyorsa) | Doğrudan `npm publish` izni |

Aynı ayarı CLI ile yapmak için npm 11.15 veya üzeri gerekir. Gerekirse tarayıcıda hesap ve 2FA doğrulamasını
tamamlayın:

```sh
npm trust github market-fiyati-mcp --repository gokhancvs/market-fiyati-mcp --file release.yml --allow-publish
```

GitHub Actions npm'e OIDC ile bağlanır. Bu yüzden `NPM_TOKEN` secret'ına veya her sürümde elle 2FA girmeye
gerek kalmaz. Workflow, GitHub-hosted Ubuntu ile Node 24 ve OIDC destekleyen bir npm sürümü (npm 11.5.1+,
Node 22.14+) kullanır. Ayrıntılar için [npm Trusted Publisher rehberine](https://docs.npmjs.com/trusted-publishers/)
bakın. Bu bağlantı kurulmadan tag gönderilirse npm adımı başarısız olur. Kurulumu tamamlayıp aynı Actions
çalışmasını yeniden başlatın.

## 2. Sürümü hazırlama

Yayımlanmış veya kaldırılmış sürüm numaraları yeniden kullanılamaz. Aşağıdaki komutlar `1.0.3`
sürümünün hazırlanmasını örnekler; sonraki yayınlarda yeni bir sürüm numarası seçin.

1. `npm version 1.0.3 --no-git-tag-version` ile `package.json` ve lockfile'daki sürümü birlikte güncelleyin.
   `src/server.ts` içindeki MCP sunucu sürümünü de aynı değere getirin.
2. README'deki sabit `npx` sürümünü, CHANGELOG'u ve `docs/releases/v1.0.3.md` sürüm notunu hazırlayın.
   Sürüm notu kurulumu, değişiklikleri ve doğrulama sınırlarını anlatmalıdır. Sentetik testleri live başarı
   gibi göstermeyin.
3. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.
4. Conventional Commits biçiminde bir commit oluşturun ve `main`'i push edin.

## 3. Tag'i gönderme

Test edilmiş commit üzerinde şu komutları çalıştırın:

```sh
git fetch origin main
git tag -a v1.0.3 -m "Release v1.0.3"
npm run release:check -- v1.0.3
git push origin v1.0.3
```

Ortamınızda RTK kuralı varsa komutların başına `rtk` ekleyin.

Tag'ler bir branch'e push edilmez. Workflow, tag'in gösterdiği commit'in `origin/main` geçmişinde olduğunu
doğrular. `main` daha sonra ilerlese bile test edilen ve paketlenen, tag'in gösterdiği commit'tir.

**Tag'i push etmek yayını onaylamak demektir.** Ayrıca "Run workflow" veya "Publish release" düğmesine
basmanız gerekmez. Workflow `v*` ile tetiklenir, ancak sürüm doğrulayıcı yalnızca kararlı `vX.Y.Z` biçimini
kabul eder. Ön sürüm (pre-release) tag'i, sürüm numarası uyuşmazlığı veya `main` dışındaki bir commit yayını
durdurur.

## 4. Otomatik akış ve başarı ölçütü

1. Tag ve commit, `main` geçmişi, paket ve lockfile sürümü ile sürüm notları doğrulanır.
2. Mevcut Ubuntu Node 22/24 ve macOS Node 24 CI kontrolleri ile üretim bağımlılığı denetimi geçer.
3. Yayın işi temiz bir kurulumla offline kontrolleri yeniden çalıştırır. Paket testi arşivin içeriğini,
   kurulan CLI'ın yardım çıktısını, stdio bağlantısını ve offline durumunu doğrular. Başarılı arşiv saklanır.
4. **Test edilmiş arşivin kendisi** OIDC ile npmjs.com'a public ve `latest` olarak gönderilir. Registry'deki
   sürüm ve SHA-512 integrity değeri eşleşmeden sonraki adıma geçilmez.
5. Sürüm notlarıyla bir GitHub Release oluşturulur ve test edilmiş `.tgz` dosyası eklenir.

**Başarılı sayılır:** GitHub Actions'taki "Publish release" çalışması yeşildir, npm'deki sürüm ve integrity
doğrudur, GitHub Release ve arşiv görünür. GitHub Packages'a yayın yapılmaz; depodaki Packages bölümünün boş
kalması normaldir. Tüm akış boyunca Market Fiyatı API'si offline kalır. npm kurulumu, npm yayını ve advisory
istekleri bu kısıtlamanın dışındadır.

Akış yarıda kalırsa **Re-run failed jobs** kullanın. Sürüm npm'de zaten varsa yayın yalnızca arşivin
integrity değeri aynıysa atlanır. İçerik farklıysa veya hedef sürüm daha önce kaldırılmışsa açık bir hata
verilir. Mevcut bir GitHub Release yeniden oluşturulmaz. Tag'leri taşımayın ve aynı sürümü farklı içerikle
paketlemeyin. Yeni sürüm, npm'deki `latest` sürümünden büyük olmalıdır; geç gelen eski bir tag `latest`
değerini geri çekemez. Yayınlar sırayla çalışır; GitHub kuyruğu en fazla 100 bekleyen yayın tutar.

## Paketi yerelde deneme

```sh
npm pack
npm install /mutlak/yol/market-fiyati-mcp-1.0.3.tgz --ignore-scripts
npm publish /mutlak/yol/market-fiyati-mcp-1.0.3.tgz --dry-run --access public
```

Kurulumu ayrı ve geçici bir klasörde yapın; CLI ve MCP doğrulaması offline modda kalsın. Dry-run, yayın
yetkinizi veya uzak API'nin davranışını kanıtlamaz. Otomatik paket testi geliştirme ve test dosyalarını
dışarıda bırakır ve arşivi bağımlılık indirmeden sınar.

## Bakım

Her `main` push'unda platform matrisi ve bağımlılık denetimi çalışır. Pazartesi 07:00 UTC'deki zamanlanmış
çalışma yalnızca üretim bağımlılıklarını denetler; GitHub zamanlanmış çalışmaları gecikebilir.
`npm audit --omit=dev` geliştirme bağımlılıklarını kapsamaz. Bağımlılıkları elle ve sabit sürümle güncelleyin.
Token, kişisel koordinat veya ham tanılama verisini Git'e ya da issue'lara eklemeyin.
