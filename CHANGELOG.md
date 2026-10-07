# Değişiklik günlüğü

En yeni değişiklikler en üsttedir. Henüz tag'lenmemiş değişiklikler **Yayımlanmamış** bölümündedir.

## Yayımlanmamış

- **Kırıcı değişiklik — ürün girdisi:** `market_get_product` girdisi artık sabit `identityType`, `pages` ve `size`
  alanlarını kabul etmez; sunucu bu değerleri (`"id"`, `0`, `1`) API'ye her zaman kendisi gönderir. Bu alanları
  gönderen çağrılar `INVALID_ARGUMENT` alır; alanları çağrıdan çıkarın.
- **Kırıcı değişiklik — harita linkleri:** Ürün, karşılaştırma ve sepet yanıtlarında offer'lar artık `maps`
  alanı taşımaz. Linkler `data.depotMaps` içinde şube başına bir kez, `depotId` anahtarıyla verilir; aynı şubenin
  linki artık her offer'da tekrarlanmaz. Kayıt; koordinat eksik, geçersiz veya aynı şubenin offer'larında
  tutarsızsa `null` olur. Kaynaktan gelen `maps` alanı offer'lardan çıkarılır. Yakındaki şubeler yanıtı
  değişmedi. `offer.maps` okuyan istemciler `depotMaps[offer.depotId]` kullanmalıdır. Bu nedenle sonraki sürüm
  2.0.0'dır.
- **AI'ya giden metinler:** Sepet kuralları (bütçe, gruplama, sunum, `splitBasket`) artık yalnız
  `market_compare_basket` açıklamasında; `discount` ve diğer ortak kurallar yalnız `market://guide`
  içinde. Prompt'lar ve guide bu kaynaklara yönlendirir. Tool açıklamalarından geliştirme notları
  kaldırıldı. Guide, kullanıcının dilinde yanıt vermeyi ve `OUTPUT_TOO_LARGE` veya
  `RESOURCE_LIMIT_EXCEEDED` sonrasında kullanıcıdan kapsamı daraltmasını istemeyi söyler.
  `market_status` açıklaması yalnız döndürdüğü alanları anlatır. Tool davranışı değişmedi.
- **Şema:** `market_get_price_history` girdisindeki `uniqueId` alanının ürün `id` değeri olduğu açıklandı.
- **Belgeler:** README'ye en üstte resmî olmama notu, istemcilere göre yapılandırma dosyası konumları,
  örnek istekler, 5 ürünlük sepet sınırı ve sorun giderme bölümü eklendi. `api.md` eksik hata kodlarını
  açıklar; yeni bir test kodda üretilen her hata kodunun belgelendiğini denetler. `api.md`, satırı olmayan
  sepet grubundaki `subtotal=0` değerini açıklar.
- **İç sadeleştirme:** Tool işlemleri tipli bir handler tablosundan geçer; ürün endpoint'lerinin listesi
  endpoint tablosundaki türden türetilir; limitler ve sunucu sürümü tek kaynaktan okunur. Yeni bir
  karakterizasyon testi tool çıktılarının, API'ye giden gövdelerin ve tool şemalarının değişmediğini denetler.
  Tool girdisi ve çıktısı bu sadeleştirmeyle değişmedi.
- **Geliştirme ortamı:** ESLint 8 ve airbnb-base yerine ESLint 10 flat config, `@eslint/js` ve
  typescript-eslint kullanılır; `.mjs` betikleri ve testleri de gerçekten denetlenir, uyarılar `check`'i
  başarısız kılar. Build düz `tsc` ile yapılır ve kullanılmayan `.d.ts` ile `.map` dosyalarını üretmez. Test
  ağ engeli DNS sorgularını ve UDP soketlerini de engeller. Yayımlanan paket ve çalışma zamanı bağımlılıkları
  değişmedi.
- **CI:** Ubuntu Node 22 ve Windows Node 24 bağımsız kurulum testleri artık `main` için zorunlu kontroller
  arasında; Windows kurulumu yayından önce PR'da doğrulanmış olur.
- **Yayın:** npm yayın betiği sadeleşti. Yayından sonra sabit 10 saniye arayla en fazla 18 okuma yapılır;
  Retry-After başlığı ve ayrı süre hesabı kaldırıldı. Yalnız test edilmiş arşivin yayımlanması, aynı sürümün
  hiçbir zaman yeniden yayımlanmaması ve integrity karşılaştırması aynen korunur.
- **Sürüm notları:** GitHub Release açıklaması artık sürümün tarihli CHANGELOG bölümünden oluşur;
  `docs/releases/` kaldırıldı. CHANGELOG'daki sürüm notu linkleri GitHub Release sayfalarına gider. Bölümlerdeki
  linkler mutlak olmalı ve repo dosya linkleri sürümün tag'ine sabitlenmeli; belge testi ve yayın kontrolü
  bunu denetler.
- **Bağımlılık güncellemeleri:** Dependabot artık npm bağımlılıkları ve GitHub Actions için ayda bir, 7 günlük
  bekleme süresinden sonra gruplu sürüm güncellemesi PR'ı açar. Major güncellemeler ayrı gelir, sabit sürümler
  korunur, merge elle yapılır.
- **Belgeler:** README sorun giderme tablosu, MSIX ile kurulan Claude Desktop'ın Windows'ta yapılandırma
  dosyasını okuduğu bildirilen sanal yolu açıklar; bu yol resmî belgede yer almaz.
- **İptal:** Sunucu artık iptal için yalnız MCP SDK'nin istek başına sinyalini kullanır; istek kimliklerini
  izleyen ek katman kaldırıldı. İptal edilen tool çağrısına `CANCELLED` sonucu yerine, MCP'nin öngördüğü gibi
  hiç yanıt gönderilmez. Kimliği `0` veya boş string olan isteklerin iptali SDK tarafından yok sayılır; aynı
  anda yinelenen istek kimlikleri artık reddedilmez.
- **Kapanış:** Sunucu kapanışı 5 saniyede bitmezse stderr'e `SHUTDOWN_TIMEOUT` yazılır ve süreç 1 koduyla
  sonlanır.

## 1.0.11 — 2026-10-06

- **Büyük yanıtlar:** Tool sonucunun stdio mesajı (metin, `structuredContent`, escape ve protokol alanları)
  9 MiB ile sınırlandı. Daha önce 8 MiB'lik zarf sınırının altında kalan bir yanıt mesajda 10 MiB'yi aşabiliyor
  ve MCP SDK 1.30+ istemcilerinde bağlantıyı kapatıyordu. Artık `OUTPUT_TOO_LARGE` (`resource: messageBytes`)
  döner ve istek ölçümleri korunur.
- **MCP Registry:** Yeni sürüm tag'i artık `server.json`'ı resmî MCP Registry'ye de yayımlar. Yayın, npm
  yayınından sonra ayrı bir işte GitHub OIDC ile yapılır; `mcp-publisher` sabit sürüm ve SHA-256 ile
  doğrulanır. İlk kayıt bir sonraki sürümle oluşur.
- **CI:** Yayın workflow'u tam platform matrisini artık tekrar çalıştırmaz; `main` branch koruması bu
  kontrolleri her commit için zaten zorunlu kılar. Yayın işi tag commit'inde `check` ve bağımsız kurulum
  testini çalıştırmaya devam eder.

[1.0.11 sürüm notları](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.11).

## 1.0.10 — 2026-10-06

- **Güvenlik:** `@modelcontextprotocol/sdk` 1.32.1'e yükseltildi. SDK'nın `express` bağımlılığı üzerinden
  gelen `proxy-addr`, IP sahteciliği bildirimi
  [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) için 2.0.8'e güncellendi.
  Sunucu yalnız stdio kullanır ve express'i yüklemez; değişiklik bağımlılık denetimini düzeltir.
- SDK 1.30 ve sonrasını kullanan stdio istemcilerinin 10 MiB mesaj okuma sınırı `docs/api.md` içinde
  belirtildi.
- SDK değişikliği: zorunlu alanı olmayan tool'lar (`market_status` gibi) `arguments` gönderilmeden de
  çağrılabilir. SDK giriş hatası metinleri yeni biçimde gelir; `Input validation error` öneki aynı kalır.
- **Belgeler:** Türkçe belgeler tek terim sözlüğüne ve düz kesme işaretine geçti; anlaşılmayan cümleler
  yeniden yazıldı, bakımcı notları ve tahmini süreler kaldırıldı. `api.md` içindeki konum başlığı
  "Konum ve şube bağlamı" oldu. 1.0.6 yarıçap geçişi, `discount` yorumu ve sentetik test sınırları tek
  bölümde toplandı. Sürüm notlarındaki linkler kendi tag'lerine sabitlendi. Yeni belge testi linkleri,
  anchor'ları ve sözlüğü denetler. Runtime davranışı değişmedi.

[1.0.10 sürüm notları](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.10).

## 1.0.9 — 2026-10-05

- **İlk kurulumda şube keşfi:** README ve örnek yapılandırma `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` içerir;
  kod varsayılanı `false` kalır. `server.json` bu ayarı listeler. `EXPERIMENTAL_DISABLED` hatası hangi ayarın
  açılacağını ve yeniden başlatmayı söyler. `live-testing.md` içindeki çelişkili örnek düzeltildi.
- **Retry-After sınırı:** Upstream'in bildirdiği bekleme süresi hatada korunur, yerel bekleme en fazla 60 saniye
  tutulur. Çok uzun bir değer artık origin'i MCP sunucusu yeniden başlatılana kadar kilitli bırakmaz.
- **Beklenmeyen hata tanılaması:** `INTERNAL_ERROR` yanıtı genel kalır; hata ve stack stderr'e tek, sınırlı bir
  JSON satırı olarak yazılır.
- **Paket içeriği:** `docs/releasing.md`, `docs/offline-acceptance.md` ve `docs/releases/` artık npm paketine girmez.

[1.0.9 sürüm notları](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.9).

## 1.0.8 — 2026-09-30

- **Varsayılan mod artık `live`:** `MARKET_FIYATI_MODE` verilmeyen kurulumlar veri sorgularında HTTP isteği
  gönderir. Ağsız geliştirme ve test için `MARKET_FIYATI_MODE=offline` açıkça ayarlanmalıdır.
- **Eski ayarların geçişi:** İstemci veya Registry kurulumunda kayıtlı `offline` değeri kendiliğinden değişmez.
  Gerçek fiyat sorgusu için değeri `live` yapın ya da 1.0.8'e yükseltip değişkeni silin; ardından sunucuyu
  yeniden başlatın. 1.0.7 ve öncesinde varsayılan mod `offline`'dır.
- CLI, Registry metadata, MCP rehberi ve kurulum belgeleri normal kullanımı geliştirici kabul testlerinden
  ayrı anlatır. Deneysel erişimin varsayılanı değişmedi; şube keşfi için ayrıca açılmalıdır.
- Varsayılan live akışı fake fetch ile sınanır. Bağımsız kurulum testi, varsayılan live başlangıcı ve açık
  offline engelini gerçek ağ engeli altında doğrular. Yeni live API doğrulaması yoktur.

[1.0.8 sürüm notları](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.8).

## 1.0.7 — 2026-09-25

- Kategori keşfinde NFC/NFD yazımları eşleştirilir; Türkçe harf ayrımı ve kaynak adları korunur.
- En ucuz şube özetindeki tekrar eden ID'ler tekilleştirilir; kaynak offer'lar korunur.
- Beklenmeyen hatalardaki kullanıcı mesajı artık var olmayan bir yerel tanılama yoluna yönlendirmez.
- 1.0.6 ile kaldırılan otomatik 1 km yarıçapın [geçişi](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.6) ve sürüm uyumluluğu
  belgelendi; konum sözleşmesi bu sürümde değişmedi. Yeni tag için tarihli CHANGELOG bölümünü zorunlu kılan kontrol eklendi.

[1.0.7 sürüm notları](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.7).

## 1.0.6 — 2026-09-25

- **Konumu bir kez ayarlayın:** Enlem, boylam ve km yarıçapı env'den okunabilir. Tam çağrı çifti ve
  distance yalnız o çağrı için önceliklidir; `depots` her ürün çağrısında gerekir.
- **Geçiş gerekiyor:** Otomatik 1 km kaldırıldı ([geçiş](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.6)). Üç değer env veya çağrıdan tamamlanmalıdır;
  ters geocode yalnız koordinat kullanır.
- **Status:** `locationDefaults.configured` ayarın varlığını gösterir; koordinatları göstermez.
- Rehberler kısaltıldı; kullanıcı kurulumu `live` modunda Galata Kulesi ve 4 km yarıçap kullanır. Env metni ile sayısal
  tool/API girdisi ayrımı açıklandı. Live API için yeni doğrulama yoktur.

[1.0.6 geçiş adımları](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.6).

## 1.0.5 — 2026-09-25

Ayrıntılar için [sürüm notlarına](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.5) bakın.

- npm kurulumu ve offline başlangıç README'de öne çıkarıldı; örnek sürüm pini paketle doğrulanır.
  Keşif anahtar kelimeleri ve sonraki yayın için MCP Registry metadata hazırlığı eklendi.
- Paket belgeleri açık dosya listesine alındı. Ayrı npm cache ve yalnız üretim bağımlılıklarıyla çalışan
  bağımsız kurulum testi eklendi; yayın işi aynı test edilmiş arşivi ayrıca kurar.
- Yayın sonrası doğrulama, yeni sürümün npm'de `latest` olarak göründüğünü kontrol eder. Registry geçici
  hata verirse (429/5xx), yanıt okunamazsa veya yeni sürüm henüz görünmüyorsa yalnız bu doğrulama isteği
  toplam beş dakika içinde tekrarlanır;
  paket yeniden gönderilmez. Integrity uyuşmazlığı veya bozuk JSON doğrulamayı hemen durdurur.
- Status, sepet, ürün karşılaştırması ve fiyat geçmişi için kararlı çıktı alanları şemada tanımlandı;
  null değerler ve upstream ek alanlar korunur.
- Özel güvenlik bildirim politikası ve güvenlik güncellemelerine yönelik Dependabot yapılandırması eklendi.

npm ve GitHub Release yayımlandı; MCP Registry yayını ayrı bir aşamadır. Live API davranışı için yeni doğrulama yoktur.

## 1.0.4 — 2026-09-24

Ayrıntılar için [sürüm notlarına](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.4) bakın.

### Düzeltilenler

- npm yayını kabul edildikten sonra registry'de görünürlük için toplam bekleme süresi 25 saniyeden
  beş dakikaya çıkarıldı. Gecikmeli doğrulama sırasında paket yeniden gönderilmez; integrity kontrolü korunur.
- Paket, MCP sunucusu ve bağlantı örneğinin sürümleri `1.0.4` olarak eşitlendi.

## 1.0.3 — 2026-09-24

Türkçe belge düzenlemeleri ve otomatik yayın akışı npm'de yayımlandı. Registry görünürlüğü
geciktiği için yayın sonrası doğrulama tamamlanamadı ve GitHub Release oluşturulmadı.
Kaynak commit'i npm provenance kaydında
[`4eafbea13e2653e9bea16e17d180ed4de3689873`](https://github.com/gokhancvs/market-fiyati-mcp/commit/4eafbea13e2653e9bea16e17d180ed4de3689873)
olarak belirtilir. Tarihsel npm paketi yeniden yayımlanmaz; güncel kurulum README'dedir.

## 1.0.2 — 2026-09-24

Yalnızca Git tag'i oluşturuldu; npm yayını yapılmadı. Registry'deki `latest` zaten `1.0.3` olduğu için
sürümün geriye gitmesini önleyen kontrol yayını durdurdu.

Ayrıntılar için [sürüm notlarına](https://github.com/gokhancvs/market-fiyati-mcp/blob/v1.0.2/docs/releases/v1.0.2.md) bakın.

### Değişenler

- `main` geçmişindeki bir commit'e yeni bir kararlı sürüm tag'i push edildiğinde offline kontroller, npm'e
  OIDC ile yayın, integrity doğrulaması ve GitHub Release oluşturma otomatik olarak çalışır.
- Belgeler kısa adımlar ve tablolarla yeniden düzenlendi; README ile API belgesi arasındaki tekrarlar azaltıldı.
- Belgeler daha anlaşılır ve sade bir Türkçeyle yeniden yazıldı. Teknik terimler İngilizce bırakıldı.

## 1.0.1 — 2026-09-24

npm'de yayımlanan ilk sürüm.

### Eklenenler

- Sürüm değişikliklerini izlemek için bu değişiklik günlüğü eklendi.
- `1.0.1` için npm yayın hazırlığı yapıldı: yalnızca seçili dosyaların paketlenmesi, paketlemeden önce
  derleme ve npm depo bilgileri.
- Dağıtım arşivinin geliştirme dosyalarını içermediğini ve offline MCP sunucusu olarak çalıştığını doğrulayan
  bir paket testi eklendi.
- Sürümü sabitlenmiş bir `npx` bağlantı örneği ve arşivden elle yayınlama adımları eklendi.

### Değişenler

- README üç adımlı kurulum ve bağlantı akışı, tahmini süreler ve başarı ölçütleriyle yeniden düzenlendi.
- Tool seçimi ve sonuçların nasıl okunacağı öne alındı. Teknik ayrıntılar, kullanım izinleri ve lisans dört
  açılır bölümde korundu.

## 1.0.0 — 2026-09-24

İlk Git sürümü: `v1.0.0`. Ayrıntılar için [sürüm notlarına](https://github.com/gokhancvs/market-fiyati-mcp/releases/tag/v1.0.0) bakın.

### Eklenenler

- Ürün arama, kategori keşfi, şube fiyatları, fiyat geçmişi ve sepet karşılaştırması için 15 tool, 3 resource
  ve 3 prompt.
- Her çağrıda açıkça verilen konum ve şube bağlamı, API facet filtreleri, sınırlı sayfalama ve TRY/kuruş
  bazında karşılaştırma.
- Upstream uyarılarının korunması, istek ölçümleri, şube kapsamı, istek bütçesi, iptal ve kaynak kullanım
  sınırları.
- Varsayılan offline mod, ağ erişimini engelleyen sentetik testler ve istemciden bağımsız sentetik kabul testleri.
- CI kontrolleri, doğrulanmış tag üzerinden taslak sürüm hazırlama ve GitHub issue şablonları.

Sentetik testlerin geçmesi, uzak API davranışının doğrulandığı anlamına gelmez. Doğrulama kapsamı ve sınırları
[doğrulama belgesinde](https://github.com/gokhancvs/market-fiyati-mcp/blob/v1.0.0/docs/verification.md) anlatılır.
