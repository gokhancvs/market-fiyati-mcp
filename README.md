# Market Fiyatı MCP

Ürün arama, kategori keşfi, şube fiyatları, fiyat geçmişi ve sepet karşılaştırması
sunan TypeScript stdio MCP sunucusu. **15 araç, 3 kaynak, 3 istem şablonu** içerir.

Varsayılan `offline` modunda ağ erişimi kapalıdır. Canlı erişim operatör tarafından
açılır. Doğrulama yöntemi, kapsamı ve sınırları [doğrulama belgesinde](docs/verification.md) yer alır.

## Amaç ve kullanım izinleri

Bu proje herhangi bir ticari kazanç veya çıkar gözetilmeksizin geliştirilmiş,
bağımsız bir yazılım çalışmasıdır. Market Fiyatı, TÜBİTAK veya market zincirleri
tarafından sunulan resmî bir ürün değildir; bu kuruluşların onayı, sponsorluğu
veya ortaklığı iddia edilmez.

Servis ve veri kullanımı için [Market Fiyatı kullanım koşullarını](https://marketfiyati.org.tr/kullanim-kosullari)
ayrıca inceleyin. Ticari amaç taşımamak, veriyi kalıcı saklamamak veya bir
endpoint'e teknik olarak erişebilmek, servis ve veri kullanımı için izin yerine
geçmez. Bu depo üçüncü taraf API erişim izni sağlamaz. Canlı kullanımdan önce
güncel koşulları ve gerekli yazılı izinleri sağlayıcıyla netleştirin; o zamana
kadar `offline` modunu kullanın.

## Kurulum

Node.js 22 veya üzeri gerekir. Proje kökünde:

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

Yerel RTK kuralı geçerliyse komutların başına `rtk` ekleyin. `npm ci` paket
kaynağına erişebilir; Market Fiyatı API'sine istek göndermez.

## MCP bağlantısı

İstemcinizin stdio yapılandırmasına aşağıdaki girdiyi ekleyin. Örnek yolu projenin
mutlak yoluyla değiştirin. GUI uygulaması `node` bulamazsa `command` alanına Node'un
mutlak yolunu yazın. Doğrudan `node` kullanmak stdout'u MCP trafiğine ayırır.

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "node",
      "args": ["/absolute/path/market-fiyati-mcp/dist/src/index.js"],
      "env": { "MARKET_FIYATI_MODE": "offline" }
    }
  }
}
```

[Örnek yapılandırma](examples/mcp-config.json). `npm start` stdio sunucusunu
başlatır; HTTP portu açmaz, bir MCP istemcisinin JSON-RPC mesajlarını bekler.
Başlangıç, araç keşfi ve kaynak okuma ağ isteği oluşturmaz.

`market_status` izinleri ve bu sürecin durumunu bildirir. Uyumluluk için korunan
`api.liveValidationPerformed` alanı deprecated'dir ve yalnız `runtime-session`
kapsamındadır: sunucu kendiliğinden canlı doğrulama yapmaz. Doğrulama kapsamı
`api.releaseVerificationReference` ile gösterilen belgede açıklanır.
Live/experimental izinlerinin açık olması uzak davranışın doğrulandığı anlamına gelmez.
`limits.basketItems` retry ayarına göre etkin sepet sınırını,
`limits.basketRequestBudget` retry dâhil deneme bütçesini, `requestPolicy` ise
çalışan sürecin retry ve istek aralığı ayarlarını gösterir.

## Araçlar

| Araç                            | İşlev                                              |
| ------------------------------- | -------------------------------------------------- |
| `market_status`                 | Mod, sınırlar ve ağ kilidi                         |
| `market_get_categories`         | Kategori ağacı, isim filtresi, alt ağaç, düz liste |
| `market_list_markets`           | Market zincirleri; deneysel                        |
| `market_find_nearby_depots`     | Konuma yakın şubeler; deneysel                     |
| `market_search_products`        | Metin, facet, sıralama ve sayfalama                |
| `market_search_by_category`     | Üç kategori seviyesinde arama                      |
| `market_get_product`            | ID ile ürün ve şube teklifleri                     |
| `market_find_similar_products`  | Benzer ürünler                                     |
| `market_find_alternatives`      | Belirli zincirde alternatifler; deneysel           |
| `market_get_price_history`      | Fiyat serileri ve değişim özeti                    |
| `market_sync_products`          | Çoklu ID ile ürün yenileme; deneysel               |
| `market_geocode_address`        | Adres önerisi; deneysel                            |
| `market_reverse_geocode`        | Koordinattan adres; deneysel                       |
| `market_compare_product_offers` | Ürün için şube fiyatlarını karşılaştırma           |
| `market_compare_basket`         | Zincir veya tek şube bazında sepet                 |

Deneysel işlemler ayrıca `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` gerektirir.
Bu işaret erişimi kontrol eder; endpoint'in canlı doğrulama durumu değildir.
Market listesi önceki canlı testlerde HTTP 500 verdi. Bu araç arama veya
karşılaştırma için önkoşul değildir; hatada aktiflik bilgisi bilinmiyor olarak
sunulur ve aynı liste sorgusu tekrarlanmamalıdır. Diğer araçlar bağımsız çalışır;
ürünlerdeki zincir adları eksiksiz market listesi veya aktiflik garantisi değildir.

## Kullanım akışı

1. `market_status` ve `market://guide` okuyun.
2. AI, verilmiş konum ve bu konum/yarıçapa ait şube bilgilerini kullanır; eksikse
   yakın şubeleri bir kez sorgular. Elle mağaza seçmek isteğe bağlıdır. Ürün
   sorgularına `latitude`, `longitude`, `distance` ve boş olmayan `depots` verilir.
3. Bilinen API filtrelerini ve sıralamayı tek aramada birleştirin. Örneğin
   `keywords="yoğurt"`, `refined_volume_weight=["3 KG"]` gramajı API'de filtreler.
   Yağ türü gibi açıklayıcı tercihler yakın alternatifleri erken elememeli;
   kullanıcının kesin şartları korunur. Ayrıntılı karar akışı `market://guide` içindedir.
4. AI, arama yanıtındaki teklifleri değerlendirir; kesin eşleşmeleri ve alternatifleri
   gerekçeleriyle sunar. Detay isteği yalnız eksik bilgi veya fiyat yenilemesi
   gerektiğinde yapılır. Sepet aracı kalem başına ayrıca detay sorgular.
   Sepet bütçesini aşmak için listeyi küçük çağrılara bölmeyin veya sync gibi
   başka araçlara geçmeyin; kullanıcıdan karşılaştırma kapsamını daraltmasını isteyin.

MCP sonuç önbelleği veya kullanıcı oturumu saklamaz. Bağlam AI tarafından her
çağrıda verilir; önceki yanıt AI bağlamında tekrar kullanılırsa özgün sorgu zamanı
belirtilir. Sunucu gizli arama genişletmesi veya sayfa taraması yapmaz.

API sayfası `pages` ile sıfırdan başlar; varsayılan `size=25`, üst sınır 100.
Her araç bir sayfa alır; `meta.pagination.nextPage` sonraki çağrılabilir sayfayı
gösterir. Yerel son sayfa endeksi 10000'dir. Daha fazla eşleşme olabileceği
halde bu sınıra gelinirse `nextPage:null` ve `PAGINATION_LIMIT_REACHED` uyarısı
döner; null tüm sonuçların görüldüğü anlamına gelmez. Çelişkili kaynak toplamı
`INVALID_RESPONSE` olur.
Kategori alanlarında ID/slug yerine Türkçe isim gönderilir. Filtre değerlerini
kategori ağacı ve dönen `facetMap` içinden seçin.

Temsili sorgu (konum kullanıcıdan, şube ID'leri o konum için API'den alınmalıdır):

```json
{
  "keywords": "yoğurt",
  "latitude": 41,
  "longitude": 29,
  "distance": 1,
  "depots": ["bim-example"],
  "pages": 0,
  "size": 25,
  "refined_volume_weight": ["3 KG"],
  "order": { "name": "offer_unit_price", "type": "asc" }
}
```

Filtreler: `menu_category`, `main_category`, `sub_category`, `market_names`,
`brand`, `refined_quantity_unit`, `refined_volume_weight`, `offer_price`,
`offer_discount`. İndirim filtresi `["true"]`; fiyat aralıkları `"10-50"`,
`"100-*"` veya `"100+"`. `order.name` için `lowest_price`/`offer_unit_price`,
`order.type` için `asc`/`desc` kullanılır. Varsayılan sıralama için `order` atlanır.
İndirim filtresi ürünün kendi `discount` alanını geçersiz kılmaz: `false` API'nin
teklifi indirimli işaretlemediğini, `true` işaretlediğini, eksik alan bilinmediğini
belirtir. Bu işaret kampanya/üyelik uygunluğu garantisi değildir. MCP ham alanları
korur; `discountlessPrice` ayrı referans fiyattır, geçmiş satış fiyatı kanıtı değildir.
Referans fiyat, oran ve promosyon metninden indirim işareti veya fiyat farkından
indirim yüzdesi üretilmez. Filtre kullanımındaki belirsizlik uyarısı korunur;
false ile yüksek referans fiyatın birlikte gelmesi çelişki olarak sınıflandırılmaz.

## Sonuçlar

Başarılı sonuç hem text hem structuredContent olarak aynı zarfı taşır:

```json
{
  "data": { "content": [] },
  "meta": {
    "source": "live",
    "endpoint": "search",
    "experimental": false,
    "retrievedAt": "2025-01-01T00:00:00Z",
    "currency": "TRY"
  },
  "warnings": []
}
```

Örnekteki tarih temsilidir. Fiyatlar TRY'dir; `indexTime` upstream güncelleme
etiketi, `retrievedAt` sorgunun tamamlandığı andır. Zaman dilimi varsayılmaz.
`percentage` indirim oranı olarak kullanılmaz. Promosyon alanları korunur;
sonuçlar stok veya üyelik koşulları garantisi vermez.

Yakın şubelerde her öğe, ürün sonuçlarında her `productDepotInfoList` teklifi
`maps` alanı taşır. Bu alan karşılaştırmanın `offers`/`unavailableOffers` ve
sepetin `lines[].offer` nesnelerinde de korunur:

```json
{
  "maps": {
    "google": "https://www.google.com/maps/search/?api=1&query=41.25%2C29.5",
    "apple": "https://maps.apple.com/?ll=41.25%2C29.5&q=41.25%2C29.5",
    "yandex": "https://yandex.com/maps/?ll=29.5%2C41.25&pt=29.5%2C41.25&z=16"
  }
}
```

Örnek koordinatlar temsilidir. Linkler şubenin koordinatını haritada işaretler;
işletme kaydı veya rota bağlantısı değildir. Koordinatlar eksik/geçersizse
`maps: null` döner. Link üretimi ek ağ isteği veya API anahtarı gerektirmez.

Hatalarda `isError=true`; uygulama hataları `error.code` taşır. SDK giriş
hataları MCP hata metni olarak gelebilir. Yaygın kodlar: `NETWORK_DISABLED`,
`EXPERIMENTAL_DISABLED`, `INVALID_ARGUMENT`, `INVALID_RESPONSE`, `HTTP_ERROR`,
`RATE_LIMITED`, `TIMEOUT`, `CANCELLED`, `RESPONSE_TOO_LARGE`, `QUEUE_FULL`,
`RESOURCE_LIMIT_EXCEEDED`, `OUTPUT_TOO_LARGE`.
Sepetin retry dâhil bütçesi aşılırsa `REQUEST_BUDGET_EXCEEDED`; şemadaki 5 ürün
sınırı aşılırsa SDK giriş hatası veya `INVALID_ARGUMENT` döner. Her iki durumda
da ürün sorgusu başlamaz.

## İstek ölçümleri ve sonuç kapsamı

Mevcut `data`, `meta` ve `warnings` zarfına ek bilgiler `meta` altında gelir:

- `requestMetrics`: Bu araç çağrısının `httpAttempts`, `retries` ve `durationMs`
  değerleri. Servisin ürettiği hata yanıtlarında da bulunur; kısmen başarısız
  sepette önceki ürünlerin denemeleri sayılır. Engellenen çağrı sıfır denemedir.
- `depotCoverage`: Ürün/karşılaştırma yanıtlarında istenen ve teklif dönen
  benzersiz şubeler, kapsam dışındakiler ve ürün başına kapsam. Teklif dönmeyen
  şubelerin durumu **bilinmiyor**; bu, stok yok demek değildir. Facet sayıları
  şube fiyatlarının eksiksiz sorgulandığını göstermez.
- `offerAssessments`: Ürün ID, şube ID ve özgün teklif indeksiyle eşleşen indirim
  değerlendirmesi ve `priceTiming`. Sorgulama zamanı ile kaynağın güncelleme
  etiketi ayrıdır; zaman dilimi bilinmediği için fiyat yaşı hesaplanmaz.
  Karşılaştırmalardaki `offerAssessmentRefs`, sıralanmış/seçilmiş teklifleri doğru
  değerlendirme kaydına bağlar.
- `warningCodes`: Metin uyarılarına eşlik eden sabit MCP kodları. API'nin kendi
  metinleri bu kodların yerine geçmez; mevcut string uyarılar korunur.

İstek sayısı `fetch` çağrılarının sayısıdır; API'nin isteği aldığının kanıtı veya
ban güvenliği garantisi değildir. Oturumun toplam bütçesini çağıran AI izler.
SDK'nin araç handler'ına ulaşmadan reddettiği girişlerde uygulama zarfı ve bu
ölçümler bulunmayabilir. Ayrıntılı alanlar ve kodlar [API sözleşmesinde](docs/api.md#yanıt-gözlemleri)
ve `market://guide` kaynağındadır. Bu bilgiler ek ağ isteği oluşturmaz.

## Sepet ve geçmiş fiyat

Sepet girdisi `items=[{"id":"ürün-id","quantity":2}]` ve ortak konum bağlamıdır.
Şema en fazla **5 farklı ürün**, ürün başına 50 paket kabul eder; yinelenen ID
reddedilir. Her ürün için bir detay sorgusu yapılır. Sepet başına bütçe **retry
dâhil 5 HTTP denemesi**: `ürün sayısı × (retries + 1) <= 5` olmalıdır. Varsayılan
retry=0 ile 5, retry=1 ile 2, retry=2/3 ile 1 ürün kabul edilir. Aşım ilk sorgudan
önce reddedilir; kullanılmayan retry payı başka ürüne aktarılmaz.

- `groupBy=market`: zincirdeki en ucuz ürün teklifleri; birden fazla şube gerekebilir.
  Eşit fiyatlar tek şubede birleşebiliyorsa ortak şube seçilir.
- `groupBy=depot`: her fiziksel şube ayrı değerlendirilir.
- Eksik üründe `total=null`; `subtotal` yalnız bulunan kalemleri kapsar.
- `splitBasket`: zincirler arası teorik minimumdur; yol ve teslimat maliyeti içermez.
- Tüm türetilmiş karşılaştırmalar yalnız seçili `depots` içindir. Dış teklifler
  `data.outOfScopeOffers` içinde korunur ve hesaplara girmez.

Hesaplar kuruş bazında yapılır. Sıfır fiyat kullanılabilir teklif sayılmaz.
Alternatif ürün otomatik seçilmez.

Bu bütçe ve varsayılan 1 saniye seri istek aralığı ihtiyatlı yerel tercihlerdir;
API'nin güvenli kotası veya ban olmayacağı garantisi değildir. Çağrı başına bütçe
global/IP kotası değildir. Kullanıcı kararıyla büyük/uzun sepet canlı testi
yapılmaz; liste bölünerek veya araç değiştirilerek bütçe aşılmaz. Sync'in 100 ID
giriş sınırı otomatik bir sepet alternatifi veya canlı yük testi izni değildir.
Küçük bir sepet de yavaş upstream nedeniyle istemci süresini aşabilir.
Kullanılan MCP SDK'nin varsayılan istek süresi 60 saniyedir; istemciler bunu
değiştirebilir. HTTP timeout yalnız tek denemeye aittir. Sunucu ilerleme
bildirimi üretmez. İstemci cancellation gönderdiğinde veya stdio bağlantısı
kapandığında aktif ve bekleyen istekler iptal edilir. Gerçek istemcinin timeout
ve durdurma davranışı yalnız sentetik gecikme ve sahte fetch ile çevrimdışı
değerlendirilir.

Fiyat geçmişi `uniqueId` ve ürünün tekliflerinde dönen şube ID'lerini alır.
`from/to` ISO tarihleriyle yerel filtreleme yapar; tarih filtresi API'ye gönderilmez.
İlk/son/min/maks değerleri ve değişim döner. Sıfır başlangıçta yüzde fark `null` olur.
API'nin `value:null` günleri eksik fiyat olarak zaman çizelgesinde korunur.
Özetlerde `points` tüm kayıtları, `availablePoints` sayısal fiyatları,
`missingPoints` eksik fiyatları sayar. Özet tarihleri ve hesaplar yalnız fiyatı
bulunan günleri kullanır; tamamı eksik veya boş aralıkta istatistikler null'dır.
Seçilen aralıkta eksik fiyat varsa `HISTORY_MISSING_VALUES` uyarısı döner.
Çoklu şube yanıtında görünmeyen teklif tek şube sorgusunda dönebilir; MCP eksik
şubeleri otomatik taramaz ve teklif dönmemesini stok yok olarak yorumlamaz.

## Kaynaklar ve istemler

Kaynaklar: `market://guide`, `market://endpoints`, `market://status`.
İstemler: `compare_shopping_list`, `find_best_product_price`, `analyze_price_history`.

## Yapılandırma

| Değişken                            | Varsayılan | İşlev                                                                        |
| ----------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `MARKET_FIYATI_MODE`                | `offline`  | `offline` veya `live`                                                        |
| `MARKET_FIYATI_ENABLE_EXPERIMENTAL` | `false`    | Deneysel uçları açar                                                         |
| `MARKET_FIYATI_TIMEOUT_MS`          | `15000`    | Deneme ve gövde okuma süresi                                                 |
| `MARKET_FIYATI_MIN_INTERVAL_MS`     | `1000`     | Süreç içi seri istek aralığı                                                 |
| `MARKET_FIYATI_MAX_RESPONSE_BYTES`  | `5242880`  | Yanıt boyut sınırı                                                           |
| `MARKET_FIYATI_RETRIES`             | `0`        | Operatör açarsa 429/502/503/504 için ek deneme sayısı; sepet bütçesine dâhil |

Yönlendirmeler takip edilmez; keyfi API URL/header/cookie yapılandırması yoktur.
Varsayılan retry kapalıdır. HTTP 500, timeout, ağ hatası ve sıradan 4xx tekrar
edilmez. Mevcut operatör ortam ayarları varsayılanları geçersiz kılar; gerçek
değerleri `market_status` ile okuyun. 5 saniyeden uzun `Retry-After`
isteği erken deneme yapılmadan hata olarak iletilir. Veriler önbelleğe alınmaz.
Taşıma kuyruğu bir aktif ve en fazla 32 bekleyen istek kabul eder; aşım
`QUEUE_FULL` ile gönderilmeden reddedilir. İptal edilen bekleyen iş kapasiteyi
hemen serbest bırakır. Çağrı başına toplam kaynak JSON boyutu da yapılandırılmış
yanıt byte sınırına tabidir. İşleme sınırları 500.000 değer/64 derinlik, 100 ürün kaydı, 10.000
teklif ve 128 upstream uyarı girdisi/64 KiB string uyarıdır. Çıktı zarfı en fazla
8 MiB olabilir. Sınır aşımında açık hata döner; alanlar/uyarılar sessizce kırpılmaz.
Ayrıntılar [kaynak kullanım sözleşmesinde](docs/api.md#kaynak-kullanım-sınırları).
Geçerli `Retry-After`, aynı API kökeni için sonraki kuyruk çağrılarını da korur:
süre dolmadan yeni istek gönderilmez, kalan süreyle hata döner. API ve harita
kökenlerinin bekleme durumu ayrıdır; bu kontrol sonuç önbelleği değildir.

## Geliştirme

`npm run build` proje `dist` dizinini temizleyip yeniden derler; eski modül veya
test çıktıları bırakılmaz. Derleyici hatası başarısız exit code ile iletilir.
CI, Ubuntu üzerinde Node 22/24 ve macOS üzerinde Node 24 için temiz kurulum ve
offline kontrol tanımlar. Ayrı dependency-audit işi npm advisory servisini sorgular;
uygulama testleri Market Fiyatı API'sine bağlanmaz.

`npm run check` biçim denetimi, lint, tip kontrolü, derleme ve ağ erişimi
engellenmiş testleri çalıştırır.
Testler sentetik veriler ve enjekte edilen sahte fetch kullanır; gerçek
fetch/HTTP/TCP/TLS erişimi preload tarafından engellenir.

`npm run format` kaynak kodunu, belgeleri ve JSON/YAML dosyalarını
projedeki `.prettierrc.json` ayarlarıyla biçimlendirir:
tek tırnak, sonda virgül olmaması, 2 boşluk girinti (tab kullanılmaz), noktalı
virgül ve 120 karakter satır hedefi. Satır sonları varsayılan LF'dir.
Biçimlendirmeyi Prettier belirler; Airbnb yapılandırmasındaki çakışan kuralları
[`eslint-config-prettier`](https://github.com/prettier/eslint-config-prettier)
kapatır. `npm run format:check` Prettier biçimini denetler.
Üretilen dosyalar ve yerel arşivler biçimlendirilmez.

`npm run lint` kaynakları, testleri ve geliştirme betiklerini denetler;
TypeScript dosyalarında `@typescript-eslint/eslint-plugin` önerilen kuralları
etkindir. Kullanılmayan değişkenler ve açık `any` kullanımı hata verir;
bilerek kullanılmayan `_` önekli parametrelere izin verilir. Mevcut Airbnb
uyarıları `--quiet` ile gizlenir; etkin hata kuralları kontrolü başarısız kılar.
Bu kurallar tip bilgisi gerektirmez; tip kontrolü ayrıca `npm run typecheck`
ile yapılır. `npm run check` lint denetimini de içerir.

Geliştirme planları kökteki `plans/`, inceleme ve test oturumu raporları
`reports/` klasöründe yerel olarak tutulur. Bu klasörler Git tarafından yok
sayılır; temiz klonda bulunmaz ve kurulum/test için gerekli değildir. Yerel
arşivleri ayrıca yedekleyin; yok sayılan dosyaları silen temizlik komutları
bu kayıtları da silebilir. Paylaşılabilir doğrulama kapsamı aşağıdaki belgede yer alır.

- [API sözleşmesi](docs/api.md)
- [Mimari](docs/architecture.md)
- [Ajan kuralları](AGENTS.md)
- [Canlı test rehberi](docs/live-testing.md)
- [Doğrulama](docs/verification.md)

Sunucu resmi Market Fiyatı ürünü değildir. Satın alma/sipariş işlemi ve barkodla
sorgulama desteklenmez. Uzak API değişiklikleri sözleşme güncellemesi gerektirebilir.

## Lisans

[MIT](LICENSE) — Copyright (c) 2026 Gökhan Çavuş.

MIT lisansı bu projenin yazılımı ve beraberindeki belgeler içindir; üçüncü taraf
verileri, markaları, logoları veya servislerine erişim için lisans ya da izin vermez. Yukarıdaki
geliştirme amacı beyanı MIT lisansını değiştirmez; koda ticari kullanım yasağı
eklemez. Üçüncü taraf bileşenlerin kendi lisansları geçerlidir.
