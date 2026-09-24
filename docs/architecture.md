# Mimari ve geliştirme

Değiştirmek istediğiniz katmanı aşağıdaki tablolardan bulun. İstek, yanıt veya fiyat anlamını etkileyen
bir değişiklik yapacaksanız önce [API sözleşmesini](api.md) okuyun.

Teknoloji: Node.js 22+, strict TypeScript, MCP SDK, Zod ve stdio üzerinden JSON-RPC.

## Bir isteğin izlediği yol

`index/server → service → transport → response-validation → analysis/observations → MCP yanıt zarfı`

| Katman    | Dosya ve sorumluluk                                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Giriş     | `index.ts`, `server.ts`: 15 tool, 3 resource ve 3 prompt tanımlar. stdout yalnızca JSON-RPC için kullanılır.                                                                                                                       |
| Sözleşme  | `contracts.ts`: 12 endpoint'i (6'sı deneysel) tanımlar. Girdileri sıkı doğrular; yanıtlardaki ek alanları korur.                                                                                                                   |
| Servis    | `service.ts`: İstek payload'unu hazırlar, kesin ID sorgularında istenmemiş veya tekrarlı ürün ID'si dönmediğini kontrol eder, sepetin 5 denemelik bütçesini (retry'lar dâhil) istekten önce denetler, metadata ve uyarıları korur. |
| Transport | `transport.ts`: Offline modda isteği engeller, live modda yalnızca sabit adreslere HTTP isteği gönderir. FIFO kuyruğu, timeout, retry, iptal ve boyut kontrolünü yönetir.                                                          |
| Analiz    | `analysis.ts`: Kategori, fiyat geçmişi ve sepet hesaplarını yan etkisiz fonksiyonlarla yapar. `money.ts`: Fiyatları half-up yuvarlamayla kuruşa çevirir ve TRY çıktısını kayıpsız üretir.                                          |

### Koruma ve açıklama katmanları

| Dosya                                                          | Sorumluluk                                                                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource-limits.ts`                                           | Çağrı boyunca kaynak, ürün, offer ve uyarı bütçelerini izler. Kontrolü veriyi kopyalamadan önce yapar, JSON boyutunu artımlı hesaplar ve aşımda açık hata döner. |
| `response-validation.ts`                                       | İlk geçersiz alanda durur. Upstream yanıttaki path ve değerleri hata ayrıntısına taşımaz.                                                                        |
| `cancellation.ts`, `cancellation-transport.ts`, `lifecycle.ts` | İstek kimliklerini ve AbortController'ları yönetir. EOF, SIGINT veya SIGTERM geldiğinde sunucuyu bir kez kapatır ve dinleyicileri temizler.                      |
| `request-metrics.ts`, `observations.ts`                        | Çağrı başına sayaçları tutar. Şube kapsamını, API'nin boolean işaretine dayanan indirim yorumunu, fiyat zamanlarını ve sabit uyarı kodlarını üretir.             |
| `maps.ts`                                                      | Şube koordinatlarından harita URL'leri üretir. Bunun için ağ gerekmez; linkler offer ve sepet çıktılarında korunur.                                              |

### Durum ve çalışma kuralları

- **Context her çağrıyla birlikte gelir.** Kullanıcı oturumu, konum veya tercih hafızası, sonuç cache'i ya da
  dosyaya yazılan veri yoktur.
- **Transport durumu geçicidir.** FIFO kuyruğunda 1 aktif ve en fazla 32 bekleyen iş bulunur. İptal edilen
  bekleyen iş ve dinleyicisi hemen kaldırılır. Retry-After bilgisi en fazla iki sunucu (API ve harita origin'i) için tutulur.
- **Kapanış tüm işleri durdurur.** SDK transport katmanı gelen istek kimliklerini yanıt verilene kadar izler.
  Aktif bir tool çağrısının iptalini SDK'ye iletmeden kendisi işler; diğer bildirimleri olduğu gibi iletir. Transport kapanınca
  bu kayıtlar silinir.
- **Analiz yalnızca seçili şubeleri kapsar.** Diğer şubelerden gelen offer'lar ayrıca saklanır. Sepet tek
  geçişte en ucuz ve eşit fiyatlı offer gruplarına ayrılır; ortak şube Set/Map ile seçilir. Grupların
  sıralanması dışında iş miktarı, offer ve çıktı sayısıyla doğru orantılı büyür.
- **Ham veri korunur.** Fiyat geçmişindeki null değerler kaybolmaz; istatistikler yalnızca sayısal
  gözlemlerden hesaplanır. Metadata üretmek ek sorgu yapmaz ve tüm ham offer'ları yeniden kopyalamaz.

Arama kararlarının tek kaynağı `src/guidance.ts` dosyası ve onu yayımlayan `market://guide` resource'udur.
Filtreleme ve sıralamayı API yapar; adayların ne anlama geldiğini çağıran AI açıklar. İndirim filtresi,
API'nin indirim işaretini değiştirmez. Market listesi endpoint'inin HTTP 500 hatası diğer endpoint'leri
etkilemez.

Sunucunun başlaması ve tool listesinin alınması ağ isteği gerektirmez. Varsayılan mod offline'dır. Live ve
deneysel erişimi operatör açar; bu ayarların açık olması live doğrulamanın başarılı olduğu anlamına gelmez.
Testler gerçek ağ erişimi gerektirmez.

## Yapılandırma

**Geçerli değerleri `market_status` ile okuyun.** Operatörün ortam değişkenleri varsayılanların yerine geçer.
Bu ayarlar tool girdisi değildir. Ortam değişkenlerini `config.ts` doğrular.

| Değişken                            | Varsayılan | Etkisi                                                                            |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `MARKET_FIYATI_MODE`                | `offline`  | `offline` veya `live`                                                             |
| `MARKET_FIYATI_ENABLE_EXPERIMENTAL` | `false`    | Deneysel endpoint'lere erişim                                                     |
| `MARKET_FIYATI_TIMEOUT_MS`          | `15000`    | Tek bir HTTP denemesi ve yanıt gövdesinin okunması için süre sınırı               |
| `MARKET_FIYATI_MIN_INTERVAL_MS`     | `1000`     | Aynı süreç içinde art arda gönderilen istekler arasındaki en kısa süre            |
| `MARKET_FIYATI_MAX_RESPONSE_BYTES`  | `5242880`  | Tek HTTP yanıtı ve çağrı başına toplam kaynak JSON boyutu için sınır              |
| `MARKET_FIYATI_RETRIES`             | `0`        | Açılırsa 429/502/503/504 yanıtlarında ek deneme yapılır; sepet bütçesine dâhildir |

URL, header veya cookie değiştirmek için bir ayar yoktur. Yönlendirmeler (redirect) izlenmez.
Retry, kuyruk ve çıktı sınırları için: [Kaynak kullanım sınırları](api.md#kaynak-kullanım-sınırları).

## Geliştirme (kontroller yaklaşık 1–2 dakika sürer)

Kaynak deponun klonunda:

1. `npm ci --ignore-scripts` ile sürümü sabitlenmiş bağımlılıkları kurun.
2. Değişikliği ve onu anlamlı şekilde sınayan testi yazın.
   [Agent kurallarına](https://github.com/gokhancvs/market-fiyati-mcp/blob/main/AGENTS.md) uyun.
3. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.

**Başarılı sayılır:** Biçim, lint, tip kontrolü, derleme ve testler hatasız biter. Süre makineye göre
değişir. Ortamınızda RTK kuralı varsa komutların başına `rtk` ekleyin.

| Komut                             | Ne yapar                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                   | `dist` klasörünü temizler ve yeniden derler. Derleme hatası olursa komut başarısız çıkış koduyla biter.                                               |
| `npm run format` / `format:check` | Prettier ile biçimlendirir veya yalnızca kontrol eder. Üretilen dosyalar ve yerel arşivler hariçtir.                                                  |
| `npm run lint`                    | Kaynak, test ve script dosyalarını denetler. Kullanılmayan değişken ve açık `any` hatadır; `_` ile başlayan kullanılmayan parametrelere izin verilir. |
| `npm run typecheck`               | Tip kontrolü yapar. Lint kuralları tip bilgisine ihtiyaç duymaz.                                                                                      |
| `npm run check`                   | Yukarıdaki kontrollerin hepsini ve ağ erişimi engellenmiş testleri çalıştırır.                                                                        |

Kod biçimi: tek tırnak, sonda virgül (trailing comma) yok, 2 boşluk girinti, noktalı virgül, satır başına
hedef 120 karakter ve LF satır sonu. Prettier ile çakışan Airbnb biçim kuralları `eslint-config-prettier`
ile kapatılır. Lint, `@typescript-eslint` önerilerini kullanır. Mevcut Airbnb uyarıları `--quiet` ile
gizlenir; hatalar ise kontrolü durdurur.

Planlar `plans/`, inceleme ve test raporları `reports/` klasöründe tutulur. Bu klasörler yereldir ve Git
tarafından yok sayılır. Temiz bir klonda gerekmezler. Git bunları saklamadığı için ayrıca yedekleyin ve temizlik yaparken silmeyin.
Paylaşılabilir doğrulama kapsamı [doğrulama belgesinde](verification.md) anlatılır.
