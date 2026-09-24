# Mimari ve geliştirme

**Değiştireceğiniz katmanı aşağıdaki tablodan bulun.** İstek/yanıt veya fiyat anlamını
etkileyen değişikliklerde önce [API sözleşmesini](api.md) okuyun.

Node.js 22+ · strict TypeScript · MCP SDK · Zod · stdio JSON-RPC.

## İstek yolu

`index/server → service → transport → response-validation → analysis/observations → MCP zarfı`

| Katman   | Dosya ve sorumluluk                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Giriş    | `index.ts`, `server.ts`: 15 araç, 3 kaynak, 3 istem; stdout yalnız JSON-RPC                                         |
| Sözleşme | `contracts.ts`: 12 endpoint/6 deneysel, katı girdiler, ek alanları koruyan yanıtlar                                 |
| Servis   | `service.ts`: wire payload, kesin-ID kontrolü, sepetin retry dâhil 5 denemelik ön kontrolü, metadata/uyarı koruması |
| Taşıma   | `transport.ts`: offline engeli veya sabit kökenlere canlı HTTP; FIFO, timeout, retry, iptal ve boyut kontrolü       |
| Analiz   | `analysis.ts`: saf kategori/geçmiş/sepet hesapları; `money.ts`: half-up kuruş dönüşümü ve kayıpsız TRY çıktısı      |

### Koruma ve açıklama katmanları

| Dosya                                                          | Sorumluluk                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `resource-limits.ts`                                           | Çağrı boyunca kaynak/ürün/teklif/uyarı bütçeleri; klonlama öncesi kontrol, artımlı JSON boyutu, aşımda açık hata |
| `response-validation.ts`                                       | İlk geçersiz düğümde durur; kaynak path/değerlerini hata ayrıntısına taşımaz                                     |
| `cancellation.ts`, `cancellation-transport.ts`, `lifecycle.ts` | İstek kimlikleri, AbortController, EOF/SIGINT/SIGTERM'de tek kapanış ve dinleyici temizliği                      |
| `request-metrics.ts`, `observations.ts`                        | Çağrı sayaçları; şube kapsamı, API boolean'ına dayanan indirim yorumu, fiyat zamanları ve sabit uyarı kodları    |
| `maps.ts`                                                      | Şube koordinatlarından harita URL'leri; ağsız üretim, teklif/sepet boyunca koruma                                |

### Durum ve çalışma kuralları

- **Bağlam her çağrıda gelir.** Kullanıcı oturumu, konum/tercih belleği, sonuç önbelleği veya dosya tabanlı veri taşıyıcısı yoktur.
- **Taşıma durumu geçicidir.** FIFO 1 aktif + 32 bekleyen iş; iptal edilen bekleyen iş/dinleyici hemen çıkarılır. Retry-After en fazla iki API kökeni için tutulur.
- **Kapanış işleri durdurur.** SDK taşıma katmanı gelen kimlikleri yanıtına kadar izler; geçerli araç iptalini SDK girişinde tüketir, diğer bildirimleri iletir. Kapanınca kayıtlar silinir.
- **Analiz kapsamı seçili şubelerdir.** Dış teklifler ayrı korunur. Sepet tek geçişte en ucuz eşitlik kümelerine ayrılır; ortak şube Set/Map ile seçilir. Grup sıralaması dışında iş teklif/çıktı sayısıyla büyür.
- **Ham veri korunur.** Null geçmiş fiyatlar kaybolmaz; istatistikler sayısal gözlemlerden çıkar. Metadata ek sorgu yapmaz veya tüm ham teklifleri tekrar kopyalamaz.

Arama kararlarının kaynağı `src/guidance.ts` / `market://guide`'dır. Filtre ve sıralamayı API yapar;
adayların anlamını AI açıklar. İndirim filtresi API işaretini değiştirmez; market-list 500 hatası diğer uçları kapatmaz.

Başlangıç/keşif ağsızdır. Offline varsayılandır; canlı/deneysel izinler operatöre aittir,
başarılı canlı doğrulama anlamına gelmez. Testlerde gerçek ağ gerekmez.

## Yapılandırma

**Çalışan değerleri `market_status` ile okuyun.** Operatör ortamı varsayılanları geçersiz kılar;
bu ayarlar araç girdisi değildir. `config.ts` ortamı doğrular.

| Değişken                            | Varsayılan | Etki                                                              |
| ----------------------------------- | ---------- | ----------------------------------------------------------------- |
| `MARKET_FIYATI_MODE`                | `offline`  | `offline` veya `live`                                             |
| `MARKET_FIYATI_ENABLE_EXPERIMENTAL` | `false`    | Deneysel uçlara erişim                                            |
| `MARKET_FIYATI_TIMEOUT_MS`          | `15000`    | Tek HTTP denemesi ve gövde okuma süresi                           |
| `MARKET_FIYATI_MIN_INTERVAL_MS`     | `1000`     | Süreç içi seri istek aralığı                                      |
| `MARKET_FIYATI_MAX_RESPONSE_BYTES`  | `5242880`  | HTTP yanıtı ve çağrı başına toplam kaynak JSON bütçesi            |
| `MARKET_FIYATI_RETRIES`             | `0`        | Açılırsa 429/502/503/504 için ek denemeler; sepet bütçesine dâhil |

Keyfî URL/header/cookie ayarı yoktur; yönlendirmeler izlenmez.
[Retry, kuyruk ve çıktı sınırları](api.md#kaynak-kullanım-sınırları).

## Geliştirin · kontrol için yaklaşık 1–2 dakika

Kaynak depo klonunda:

1. `npm ci --ignore-scripts` ile sabit bağımlılıkları kurun.
2. Değişikliği ve ilgili anlamlı testi yazın; [ajan kurallarını](https://github.com/gokhancvs/market-fiyati-mcp/blob/main/AGENTS.md) izleyin.
3. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.

**Başarı işareti:** Biçim, lint, tip kontrolü, derleme ve testler hatasız biter.
Süre makineye bağlıdır. Yerel RTK kuralı varsa komutlara `rtk` ekleyin.

| Komut                             | Sonuç                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run build`                   | `dist` temizlenir ve yeniden derlenir; derleyici hatası başarısız çıkış kodudur                              |
| `npm run format` / `format:check` | Prettier ile biçimlendirme / kontrol; üretilen dosyalar ve yerel arşivler hariç                              |
| `npm run lint`                    | Kaynak, test ve betikler; kullanılmayan değişken/açık `any` hata, `_` önekli kullanılmayan parametre serbest |
| `npm run typecheck`               | Tip kontrolü; lint kuralları tip bilgisi gerektirmez                                                         |
| `npm run check`                   | Yukarıdaki kontroller ve ağ korumalı testler                                                                 |

Biçim: tek tırnak, trailing comma yok, 2 boşluk, noktalı virgül, 120 karakter hedefi, LF.
Prettier çakışan Airbnb biçim kurallarını `eslint-config-prettier` ile kapatır.
Lint `@typescript-eslint` önerilerini kullanır; mevcut Airbnb uyarıları `--quiet` ile gizlenir, hatalar kontrolü durdurur.

Planlar `plans/`, inceleme/test raporları `reports/` altında yerel ve Git-ignore'dur.
Temiz klonda gerekmez; ayrıca yedekleyin, temizlikte silmeyin. Paylaşılabilir kanıt kapsamı
[doğrulama belgesindedir](verification.md).
