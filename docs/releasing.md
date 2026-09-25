# Sürüm hazırlama

**Yeni bir kararlı sürüm tag'ini push etmek, npm ve GitHub yayınını otomatik olarak başlatır.** Bu rehber
kaynak deponun klonunda çalışanlar içindir.

Tek geliştirme branch'i `main`'dir. Tag biçimi `vX.Y.Z` şeklindedir. Patch sürümü hata düzeltmesi, minor
sürümü geriye uyumlu yeni özellik, major sürümü uyumsuz bir sözleşme değişikliği içerir. Yayımlanmış bir tag
veya npm sürümü sonradan değiştirilmez.

Bu rehberdeki sürüm hazırlama, merge, tag gönderme ve katalog yayını aşamalarından kullanıcının
istediği kapsamı tamamlayın. Verilmiş onayı yeniden istemeyin; yalnız kod değişikliği talebini
kendiliğinden yayın yetkisi olarak yorumlamayın.

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

Yayımlanmış veya kaldırılmış sürüm numaraları yeniden kullanılamaz. Aşağıdaki komutlar `1.0.6`
sürümünün hazırlanmasını örnekler; sonraki yayınlarda yeni bir sürüm numarası seçin.

1. `npm version 1.0.6 --no-git-tag-version` ile `package.json` ve lockfile'daki sürümü birlikte güncelleyin.
   `src/server.ts` içindeki MCP sunucu sürümünü de aynı değere getirin.
2. README ve `examples/mcp-config.json` içindeki sabit `npx` sürümünü, `server.json` sürümlerini, CHANGELOG'u ve `docs/releases/v1.0.6.md` sürüm notunu hazırlayın.
   Sürüm notu kurulumu, değişiklikleri ve doğrulama sınırlarını anlatmalıdır. Sentetik testleri live başarı
   gibi göstermeyin. Yeni sürüm notunun yolunu `package.json` files listesine ve paket testinin belge listesine ekleyin.
3. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.
4. Conventional Commits biçiminde commit oluşturun, PR açın ve zorunlu CI kontrollerinden sonra `main`'e birleştirin.
   `main` doğrudan push yerine PR gerektirir; force-push ve silme kapalıdır.

## 3. Tag'i gönderme

Test edilmiş commit üzerinde şu komutları çalıştırın:

```sh
git fetch origin main
git tag -a v1.0.6 -m "Release v1.0.6"
npm run release:check -- v1.0.6
git push origin v1.0.6
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
2. Ubuntu Node 22/24 ve macOS Node 24 offline kontrolleri, üretim bağımlılığı denetimi ve
   Ubuntu Node 22 / Windows Node 24 bağımsız tüketici kurulum işleri geçer.
3. Yayın işi offline kontrolleri yeniden çalıştırır. Paket testi arşiv içeriğini, yardım çıktısını ve
   stdio bağlantısını checkout bağımlılıklarıyla sınar. Saklanan **aynı arşiv**, ayrı cache ve geçici
   dizinde `--omit=dev --ignore-scripts` ile kurulur; npm'in oluşturduğu binary ağ engeliyle çalıştırılır.
4. **Test edilmiş arşivin kendisi** OIDC ile npmjs.com'a public ve `latest` olarak gönderilir.
   Version, SHA-512 integrity ve yeni yayında `latest` eşleşmesi doğrulanır. Yayın sonrasındaki geçici
   bağlantı hataları ve 429/502/503/504 yalnız salt okunur doğrulamada tekrar denenir; publish tekrarlanmaz.
   HTTP süreleri dahil toplam doğrulama sınırı beş dakika, ek üst sınır 61 okumadır. Normal bekleme beş
   saniye; daha uzun Retry-After varsa erken istek gönderilmez. Süreye sığmıyorsa açık hata verilir.
5. Sürüm notlarıyla bir GitHub Release oluşturulur ve test edilmiş `.tgz` dosyası eklenir.

## Yayın sonrası kapanış

- Workflow sonucunu izleyin; npm sürümü, `latest` ve integrity doğrulaması ile GitHub Release ve
  arşiv oluşmadan yayını tamamlanmış saymayın. Hata varsa başarısız aşamayı ve sonraki işlemi kaydedin.
- `package.json` keywords, yayımlanan npm keywords ve GitHub Topics aynı değer kümesini taşımalıdır;
  sıralama önemli değildir. Eksik ve fazladan etiketleri eşitleyin.
- GitHub Release açıklamasını gerçek yayın durumuyla eşitleyin; hazırlık ifadelerini güncelleyin ve
  belge bağlantılarını yayımlanan tag'e sabitleyin. Yayımlanan tag veya npm içeriğini değiştirmeyin.
- Merge sonrası kaynak branch'in GitHub tarafından silindiğini doğrulayın. Yerel branch/worktree
  temizliğinde `AGENTS.md` kapanış kurallarını uygulayın ve özel arşivleri koruyun.
- npm ve MCP Registry yayın durumlarını ayrı bildirin. Katalog yayını kapsamdaysa aşağıdaki rehberi
  izleyip yayımlanan ad/sürümü registry'den doğrulayın; manifest doğrulamasını yayın kanıtı saymayın.

**Başarılı sayılır:** GitHub Actions'taki "Publish release" çalışması yeşildir, npm'deki sürüm ve integrity
ve yeni yayın için `latest` doğrudur, GitHub Release ve arşiv görünür. GitHub Packages'a yayın yapılmaz; depodaki Packages bölümünün boş
kalması normaldir. Tüm akış boyunca Market Fiyatı API'si offline kalır. npm kurulumu, npm yayını ve advisory
istekleri bu kısıtlamanın dışındadır.

Akış yarıda kalırsa **Re-run failed jobs** kullanın. Sürüm npm'de zaten varsa yayın yalnızca arşivin
integrity değeri aynıysa atlanır. `latest` aynı veya daha yeni kararlı sürümse tarihsel doğrulama başarılıdır; eski/eksik etiket sınırlı süreyle tekrar okunur ve düzelmezse hata verir. Etiket otomatik değiştirilmez. İçerik farklıysa veya hedef sürüm daha önce kaldırılmışsa açık bir hata
verilir. Mevcut bir GitHub Release yeniden oluşturulmaz. Tag'leri taşımayın ve aynı sürümü farklı içerikle
paketlemeyin. Yeni sürüm, npm'deki `latest` sürümünden büyük olmalıdır; geç gelen eski bir tag `latest`
değerini geri çekemez. Yayınlar sırayla çalışır; GitHub kuyruğu en fazla 100 bekleyen yayın tutar.

## Paketi yerelde deneme

```sh
npm pack
npm run test:consumer
npm publish /mutlak/yol/market-fiyati-mcp-1.0.6.tgz --dry-run --access public
```

`npm run test:consumer` derleme/paketleme yapar, yeni cache ile geçici dizine bağımsız kurar ve gerçek
npm binary'sini sınar. npm indirmeleri ağ kullanabilir; MCP süreci `tests/no-network.mjs` ile offline kalır.
Hazır test edilmiş arşiv için `npm run test:consumer -- /mutlak/yol/pack.json` kullanın.
Önceden hazırlanmış kurulum için `npm run test:installed -- /mutlak/yol/kurulum` yalnız MCP kabulünü yapar. Dry-run, yayın
yetkinizi veya uzak API'nin davranışını kanıtlamaz. Otomatik paket testi geliştirme ve test dosyalarını
dışarıda bırakır ve arşivi bağımlılık indirmeden sınar.

## Bakım

Her `main` push'unda platform matrisi ve bağımlılık denetimi çalışır. Pazartesi 07:00 UTC'deki zamanlanmış
çalışma yalnızca üretim bağımlılıklarını denetler; GitHub zamanlanmış çalışmaları gecikebilir.
`npm audit --omit=dev` geliştirme bağımlılıklarını kapsamaz. Dependabot normal sürüm PR'ları kapalı, güvenlik güncellemeleri açıktır. Otomatik merge yoktur;
güncellemeler manifest/lockfile uyumu ve offline kontrollerle değerlendirilir. Diğer bağımlılıkları
ayrı bakım PR'larında ve sabit sürümle güncelleyin. [Güvenlik bildirimi](../SECURITY.md) özel kanalı kullanır.
Token, kişisel koordinat veya ham tanılama verisini Git'e ya da issue'lara eklemeyin.

## MCP Registry hazırlığı

`server.json` bir hazırlık manifestidir; registry yayını yapıldığı anlamına gelmez. npm paketi içindeki
`mcpName` ile manifest `name` eşleşmelidir. Mevcut yayımlanmış 1.0.4 bu yeni metadata'yı içermez;
bu sürüm numarasını yeniden yayımlamayın. Sonraki sürüm hazırlanırken manifestin üst `version` ve
`packages[].version` alanlarını paketle birlikte güncelleyin, ardından önce npm yayınını doğrulayın.

Resmî [Registry yayın rehberini](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
izleyin. Manifesti belirtilen resmî JSON şemasıyla doğrulayın; kullandığınız publisher sürümü destekliyorsa
`mcp-publisher validate` kullanın. Publisher 1.8.1 yardımında listelense de bu komutu tanımayabilir;
bu durumda JSON Schema doğrulaması yalnız yerel yapıyı kanıtlar, npm sahipliği veya yayın kabulünü değil.
GitHub ile giriş ve `mcp-publisher publish` ayrı yayın işlemleridir; release workflow'u bunları otomatik yapmaz.

Yeni consumer-install işleri ilk uzak çalışmada görüldükten sonra bu işlerin gerçek adlarını main'in
zorunlu kontrollerine ekleyin. Yeni işlerin tanımlanması tek başına Windows kabulünün başarılı olduğunu kanıtlamaz.
