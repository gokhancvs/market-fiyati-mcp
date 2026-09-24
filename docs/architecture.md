# Mimari

Node.js 22+, strict TypeScript, MCP SDK ve Zod. Taşıma stdio'dur.

- `contracts.ts`: endpoint allowlist, deneysel işaretler, katı giriş şemaları ve
  ek alanları koruyan yanıt şemaları; 12 uzak endpoint, bunların 6 tanesi deneysel.
- `config.ts`: yalnız offline/live modları; ortam değişkeni doğrulaması.
- `transport.ts`: OfflineTransport istekleri engeller. LiveTransport sabit kökenlere
  HTTP gönderir; timeout, iptal, boyut sınırı, seri istek aralığı ve sınırlı retry uygular.
  Bir aktif ve en fazla 32 bekleyen işten oluşan FIFO kullanır; iptal edilen
  bekleyen işi ve dinleyicisini hemen kaldırır, kapasite aşımında gönderim yapmaz.
- `service.ts`: argümanlardan wire payload kurar, yanıtı doğrular, metadata ve
  uyarıları korur; kullanıcı bağlamı her çağrıda açıktır.
  Kesin-ID doğrulaması tüm ürün sorgularının ortak yolundadır. Sepet başlamadan
  retry dâhil 5 denemelik bütçesi denetlenir. İndirim filtresinin ürünün API
  işaretini geçersiz kılmadığı ve market-list 500 hatasının bağımsız kapsamı açıklanır.
- `analysis.ts`: saf kategori, fiyat geçmişi ve para/sepet hesapları.
  Karşılaştırmalar servis tarafından verilen seçili şubelerle sınırlıdır; dış
  teklifler ayrı korunur. Sepet teklifleri bir geçişte ürün/grup bazında en ucuz
  eşitlik kümelerine indekslenir; ortak fiziksel şube Set/Map üyeliğiyle seçilir.
  Grup sıralaması dışında iş yükü teklif ve çıktı satırı sayısıyla büyür.
  Fiyat geçmişindeki null günler çıktıda korunur; istatistikler sayısal
  gözlemlerden üretilir, mevcut/eksik nokta sayıları ayrı raporlanır.
- `resource-limits.ts`: çağrıya özel kümülatif kaynak, ürün, teklif ve uyarı bütçeleri.
  Şema klonlaması ve türetilmiş dizilerden önce girdiyi sınırlar; son zarfın JSON
  boyutunu artımlı sayarak text/structuredContent çoğaltmasını sınırlar.
  Aşımda kısmi veri yerine açık hata verir; kabul edilen ek alanları kırpmaz.
- `response-validation.ts`: yanıt yapısını ve ek JSON alanlarını ilk geçersiz
  düğümde durarak doğrular; raw upstream path/değeri hata ayrıntısına taşımaz.
- `cancellation.ts` / `cancellation-transport.ts`: public SDK taşıma arayüzünde
  tüm gelen istek kimliklerini yanıtına kadar izler; araç isteklerine uygulama
  AbortController'ı bağlar. Geçerli araç iptalini SDK'ye girişte tüketir,
  diğer bildirimleri iletir;
  kapanışta aktif kayıtları iptal edip siler. Sonuç veya kullanıcı bağlamı tutmaz.
- `money.ts`: ondalık half-up kuruş dönüşümü ve kayıpsız sayısal tutar denetimi.
- `lifecycle.ts`: EOF/SIGINT/SIGTERM için tek seferlik kapanış; SDK üzerinden aktif
  ve kuyruktaki işlerin iptali ve dinleyici temizliği.
- `maps.ts`: doğrulanmış şube koordinatlarından Google, Apple ve Yandex harita
  bağlantıları üretir; ağ isteği yapmaz. `service.ts` bağlantıları şube ve
  tekliflere ekler, karşılaştırma ve sepet hesapları bu alanları korur.
- `request-metrics.ts`: çağrıya ait HTTP deneme/tekrar sayaçları ve süre tipleri.
  Servis sayaçları taşıyıcıya açıkça geçirir; taşıyıcı gerçek fetch sınırında artırır.
  Servis başarı/hata dönüşünde kopyasını alır. Paylaşılan oturum sayacı yoktur.
- `observations.ts`: saf şube kapsamı, yalnız API discount boolean'ına dayanan
  indirim değerlendirmesi, fiyat zamanı açıklamaları ve
  sabit uyarı kodları. Ham alanlara dokunmadan `meta` altında bilgi sağlar.
  Kaynak tekliflerin tamamını tekrar kopyalamaz veya yeni sorgu başlatmaz.
- `server.ts` / `index.ts`: 15 araç, 3 kaynak, 3 prompt, stdout JSON-RPC.
- `tests/`: sentetik girdiler, sahte fetch, bellek içi SDK ve stdio testleri.

Sunucu özel veri dosyası gerektirmez, dosya tabanlı veri taşıyıcısı yoktur.
Kullanıcı bağlamı ve sonuçlar açısından stateless çalışır: önbellek, hatırlanan
konum/şube veya tercih yoktur. AI her çağrıya bağlamı sağlar. İstek kuyruğu ve
hız sınırlaması taşıma mekanizmasıdır; sonuç veya kullanıcı tercihlerini saklamaz.
Retry-After beklemesi API kökeni bazında taşınır; en fazla iki kökenlik kontrol
durumudur. İstemci bağlantısı kapandığında bekleyen işler devam ettirilmez.
Arama kararlarının kaynağı `src/guidance.ts` / `market://guide` rehberidir;
API filtreleri ve sıralaması kullanılır, adayların anlamı AI tarafından açıklanır.
Başlangıçta ve araç/kaynak keşfinde ağ isteği oluşmaz. Varsayılan offline'dır;
canlı test izni ve runtime ayarları operatöre aittir. Deneysel ayar API'nin başarılı
canlı doğrulandığını ifade etmez. Hiçbir test gerçek ağ erişimine ihtiyaç duymaz.

Başarılı çıktı `{data,meta,warnings}`; hata aynı zarf ve `error` alanı ile
`isError=true` döner. Başarı ve hata zarfı aynı çıktı bütçesinden geçer.
Geçersiz upstream JSON/şema, HTTP hata durumu, timeout, iptal
ve boyut aşımı ayrı hata kodlarıdır. Ham hata gövdeleri dışarı sızdırılmaz.
