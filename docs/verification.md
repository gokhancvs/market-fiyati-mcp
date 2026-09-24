# Doğrulama kapsamı

## Çevrimdışı kontroller

`MARKET_FIYATI_MODE=offline npm run check` biçim ve lint denetimlerini, tip
kontrolünü, derlemeyi ve otomatik testleri çalıştırır. Lint regresyonu kaynak ve
test dosyalarında geçerli TypeScript'in kabulünü, kullanılmayan değişkenlerin
ve açık `any` kullanımının reddini doğrular. Testler sentetik girdiler ve enjekte edilen sahte fetch
kullanır; `tests/no-network.mjs` gerçek ağ erişimini engeller.

Kontroller giriş/yanıt sözleşmelerini, para ve sepet hesaplarını, fiyat geçmişini,
uyarıların korunmasını, taşıma hatalarını, retry/iptal davranışını ve MCP
entegrasyonunu kapsar. Seçilmeyen şubelerin sıralama ve sepet toplamından
dışlanması, ham kanıt ve değerlendirme bağlantılarının korunması, FIFO kapasitesi
ve bekleyen iptallerin temizliği ayrıca test edilir. Sentetik büyüme testi çok
sayıda şube ve ayrık eşit fiyat kümelerinde alan erişimi sayısını ölçer; süre
eşiği veya canlı yük testi değildir.

Sepette sıfır ve kuruşa yuvarlanınca sıfır olan tekliflerin ham alanlarıyla
korunması, kapsam dışı tekliflerden ayrılması ve özgün değerlendirmeye bağlanması
test edilir. Bu ek ham verinin de çıktı bütçesine girdiği ve aşımda kısmi başarı
yerine açık MCP hatası döndüğü doğrulanır.

Sepet eşitliklerinde locale'den bağımsız kimlik sırası, endpoint allowlist'inde
yalnız doğrudan tanımlı anahtarların kabulü ve çevrimdışı ağ engelinin izole
alt süreçteki self-test'i de doğrulanır. Ağ testi gerçek bağlantı kurmadan
fetch, TCP, HTTP, HTTPS, TLS ve HTTP/2 girişlerini sınar; DNS/UDP veya tüm özel
HTTP/2 sağlayıcıları için kapsam iddia etmez.

Kaynak sınırı testleri uyarıların genişletilmeden reddini, kabul sınırında alan
korunmasını, sepet boyunca biriken bütçeleri, teklifsiz ürünlerin şube metadata’sını
büyütmeden reddini, JSON derinlik/değer/byte sınırlarını,
Unicode/escape hesabını ve büyük çıktının MCP hata zarfına dönüşmesini kapsar.
Ek regresyonlar sonlu olmayan JSON sayılarını, ilk geçersiz yanıt alanında durmayı,
uzun facet anahtarlarının tanılamaya taşınmamasını ve büyük/geçersiz hata
ayrıntılarının sabit bütçeli MCP hatasına dönüşmesini kapsar. SDK sınırında
sayısal sıfır/boş kimlik, erken iptal, iki yönde yinelenen kimlik, yanıt
callback'inde hemen tekrar kullanım ve kapanış temizliği;
ürün zincir anahtarı ve sayfalama toplam/sınır koşulları sentetik olarak sınanır.
Kapsam ilgili sürümün test dosyalarından okunmalıdır.

[Çevrimdışı MCP kabul kiti](offline-acceptance.md), gerçek MCP stdio istemcisini
sentetik ürünlerle sınar ve masaüstü Stop/kapatma ile modelin sonuç yorumunu
ayrı elle değerlendirmek için senaryolar sağlar. SDK test başarısı, masaüstü
kabulünün veya canlı API davranışının gözlendiği anlamına gelmez.

## Canlı davranışın sınırları

Yerel test başarısı uzak API'nin erişilebilirliğini, stok durumunu, fiyatların
kasa fiyatıyla eşleşmesini veya kampanya koşullarını doğrulamaz. Deneysel erişimin
açık olması canlı doğrulama kanıtı değildir. Ürün ve şube kapsamı her yanıtta
ayrıca değerlendirilir; eksik teklif stok yok anlamına gelmez.

Market listesi için başarılı erişim garantisi verilmez; bu uçtaki hata diğer
arama ve karşılaştırma işlemlerinin çalışmasına engel değildir. Uzun sepet ve
yük denemeleri canlı kabul kapsamına dahil değildir. İstemci timeout/iptal
akışlarının gerçek masaüstü kabulü, sentetik testlerden ayrı değerlendirilir.

Canlı testler yalnız kullanıcıyla, [canlı test rehberine](live-testing.md) göre
yürütülür. Sözleşmeler ve sonuçların yorumlanması [API belgesinde](api.md)
açıklanır. Bu belge oturum sonuçları veya ham ölçüm dökümleri içermez.
