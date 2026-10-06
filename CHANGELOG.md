# Değişiklik günlüğü

En yeni değişiklikler en üsttedir. Henüz tag'lenmemiş değişiklikler **Yayımlanmamış** bölümündedir.

## Yayımlanmamış

- **MCP Registry:** Yeni sürüm tag'i artık `server.json`'ı resmî MCP Registry'ye de yayımlar. Yayın, npm
  yayınından sonra ayrı bir işte GitHub OIDC ile yapılır; `mcp-publisher` sabit sürüm ve SHA-256 ile
  doğrulanır. İlk kayıt bir sonraki sürümle oluşur.

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

[1.0.10 sürüm notları](docs/releases/v1.0.10.md).

## 1.0.9 — 2026-10-05

- **İlk kurulumda şube keşfi:** README ve örnek yapılandırma `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` içerir;
  kod varsayılanı `false` kalır. `server.json` bu ayarı listeler. `EXPERIMENTAL_DISABLED` hatası hangi ayarın
  açılacağını ve yeniden başlatmayı söyler. `live-testing.md` içindeki çelişkili örnek düzeltildi.
- **Retry-After sınırı:** Upstream'in bildirdiği bekleme süresi hatada korunur, yerel bekleme en fazla 60 saniye
  tutulur. Çok uzun bir değer artık origin'i MCP sunucusu yeniden başlatılana kadar kilitli bırakmaz.
- **Beklenmeyen hata tanılaması:** `INTERNAL_ERROR` yanıtı genel kalır; hata ve stack stderr'e tek, sınırlı bir
  JSON satırı olarak yazılır.
- **Paket içeriği:** `docs/releasing.md`, `docs/offline-acceptance.md` ve `docs/releases/` artık npm paketine girmez.

[1.0.9 sürüm notları](docs/releases/v1.0.9.md).

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

[1.0.8 sürüm notları](docs/releases/v1.0.8.md).

## 1.0.7 — 2026-09-25

- Kategori keşfinde NFC/NFD yazımları eşleştirilir; Türkçe harf ayrımı ve kaynak adları korunur.
- En ucuz şube özetindeki tekrar eden ID'ler tekilleştirilir; kaynak offer'lar korunur.
- Beklenmeyen hatalardaki kullanıcı mesajı artık var olmayan bir yerel tanılama yoluna yönlendirmez.
- 1.0.6 ile kaldırılan otomatik 1 km yarıçapın [geçişi](docs/api.md#106-yarıçap-geçişi) ve sürüm uyumluluğu
  belgelendi; konum sözleşmesi bu sürümde değişmedi. Yeni tag için tarihli CHANGELOG bölümünü zorunlu kılan kontrol eklendi.

[1.0.7 sürüm notları](docs/releases/v1.0.7.md).

## 1.0.6 — 2026-09-25

- **Konumu bir kez ayarlayın:** Enlem, boylam ve km yarıçapı env'den okunabilir. Tam çağrı çifti ve
  distance yalnız o çağrı için önceliklidir; `depots` her ürün çağrısında gerekir.
- **Geçiş gerekiyor:** Otomatik 1 km kaldırıldı ([geçiş](docs/api.md#106-yarıçap-geçişi)). Üç değer env veya çağrıdan tamamlanmalıdır;
  ters geocode yalnız koordinat kullanır.
- **Status:** `locationDefaults.configured` ayarın varlığını gösterir; koordinatları göstermez.
- Rehberler kısaltıldı; kullanıcı kurulumu `live` modunda Galata Kulesi ve 4 km yarıçap kullanır. Env metni ile sayısal
  tool/API girdisi ayrımı açıklandı. Live API için yeni doğrulama yoktur.

[1.0.6 geçiş adımları](docs/releases/v1.0.6.md).

## 1.0.5 — 2026-09-25

Ayrıntılar için [sürüm notlarına](docs/releases/v1.0.5.md) bakın.

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

Ayrıntılar için [sürüm notlarına](docs/releases/v1.0.4.md) bakın.

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

Ayrıntılar için [sürüm notlarına](docs/releases/v1.0.2.md) bakın.

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

İlk Git sürümü: `v1.0.0`. Ayrıntılar için [sürüm notlarına](docs/releases/v1.0.0.md) bakın.

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
[doğrulama belgesinde](docs/verification.md) anlatılır.
