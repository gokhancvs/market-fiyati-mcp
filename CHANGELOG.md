# Değişiklik günlüğü

En yeni değişiklikler en üsttedir. Henüz tag'lenmemiş değişiklikler **Yayımlanmamış** bölümündedir.

## Yayımlanmamış

- Kategori keşfinde NFC/NFD yazımları eşleştirilir; Türkçe harf ayrımı ve kaynak adları korunur.
- En ucuz şube özetindeki tekrar eden ID'ler tekilleştirilir; kaynak offer'lar korunur.
- Beklenmeyen hatalardaki kullanıcı mesajından mevcut olmayan yerel teşhis yönlendirmesi kaldırıldı.

## Yayımlanmamış — 1.0.6

- **Konumu bir kez ayarlayın:** Enlem, boylam ve km yarıçapı env’den okunabilir. Tam çağrı çifti ve
  distance yalnız o çağrı için önceliklidir; `depots` her ürün çağrısında gerekir.
- **Geçiş gerekiyor:** Otomatik 1 km kaldırıldı. Üç değer env veya çağrıdan tamamlanmalıdır;
  ters geocode yalnız koordinat kullanır.
- **Status:** `locationDefaults.configured` ayarın varlığını gösterir; koordinatları göstermez.
- Rehberler kısaltıldı; kullanıcı kurulumu `live` modunda Galata Kulesi ve 4 km yarıçap kullanır. Env metni ile sayısal
  tool/API girdisi ayrımı açıklandı. Canlı API için yeni doğrulama yoktur.

[1.0.6 geçiş adımları](docs/releases/v1.0.6.md).

## 1.0.5 — 2026-09-25

Ayrıntılar için [sürüm notlarına](docs/releases/v1.0.5.md) bakın.

- npm kurulumu ve offline başlangıç README'de öne çıkarıldı; örnek sürüm pini paketle doğrulanır.
  Keşif anahtar kelimeleri ve sonraki yayın için MCP Registry metadata hazırlığı eklendi.
- Paket belgeleri açık dosya listesine alındı. Ayrı npm cache ve üretim bağımlılıklarıyla bağımsız
  tüketici/binary kontrolü eklendi; yayın işi aynı test edilmiş arşivi ayrıca kurar.
- Yeni npm yayınında `latest` doğrulanır; geçici registry ve gövde okuma hataları toplam beş dakikalık
  süre içinde yalnız doğrulama isteğini tekrarlar. Integrity uyuşmazlığı ve bozuk JSON hemen durdurur.
- Status, sepet, ürün karşılaştırması ve fiyat geçmişi için kararlı çıktı alanları şemada ilan edilir;
  null değerler ve upstream ek alanlar korunur.
- Özel güvenlik bildirim politikası ve güvenlik güncellemelerine yönelik Dependabot yapılandırması eklendi.

npm ve GitHub Release yayımlandı; MCP Registry yayını ayrı bir aşamadır. Canlı API davranışı için yeni doğrulama yoktur.

## 1.0.4 — 2026-09-24

Ayrıntılar için [sürüm notlarına](docs/releases/v1.0.4.md) bakın.

### Düzeltilenler

- npm yayını kabul edildikten sonra registry'de görünürlük için toplam bekleme süresi 25 saniyeden
  beş dakikaya çıkarıldı. Gecikmeli doğrulama sırasında paket yeniden gönderilmez; integrity kontrolü korunur.
- Paket, MCP sunucusu ve bağlantı örneğinin sürümleri `1.0.4` olarak eşitlendi.

## 1.0.3 — 2026-09-24

Türkçe dokümantasyon düzenlemeleri ve otomatik yayın akışı npm'de yayımlandı. Registry görünürlüğü
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
- Dokümanlar kısa adımlar ve tablolarla yeniden düzenlendi; README ile API belgesi arasındaki tekrarlar azaltıldı.
- Dokümanlar daha anlaşılır ve sade bir Türkçeyle yeniden yazıldı. Teknik terimler İngilizce bırakıldı.

## 1.0.1 — 2026-09-24

npm dağıtımı için hazırlanan sürüm. Bu kayıt, npm yayınının gerçekleştiğinin kanıtı değildir.

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
- Her çağrıda açıkça verilen konum ve şube context'i, API facet filtreleri, sınırlı sayfalama ve TRY/kuruş
  bazında karşılaştırma.
- Upstream uyarılarının korunması, istek ölçümleri, şube kapsamı, istek bütçesi, iptal ve kaynak kullanım
  sınırları.
- Varsayılan offline mod, ağ erişimini engelleyen sentetik testler ve istemciden bağımsız bir kabul kiti.
- CI kontrolleri, doğrulanmış tag üzerinden taslak sürüm hazırlama ve GitHub issue şablonları.

Sentetik testlerin geçmesi, uzak API davranışının doğrulandığı anlamına gelmez. Doğrulama kapsamı ve sınırları
[doğrulama belgesinde](docs/verification.md) anlatılır.
