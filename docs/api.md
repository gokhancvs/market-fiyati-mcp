# API sözleşmesi

**Çağrınıza ait bölümü açın; filtre ve kimlik değerlerini API yanıtından alın.**
Bu, bağımsız MCP uygulamasının sözleşmesidir; sağlayıcının resmî belgesi veya kullanım izni değildir.
[İzinler](../README.md#amaç-ve-kullanım-izinleri) · [Doğrulama sınırı](verification.md).

## Endpoint'ler

Sabit kökenler: `https://api.marketfiyati.org.tr` ve `https://harita.marketfiyati.org.tr/Service/api/v1`.
Katalog: **12 endpoint, 6 deneysel**. `market://endpoints` okumak ağ isteği yapmaz.
Deneysel erişim ortam ayarı gerektirir; hiçbir uç için uzak davranış garantisi değildir.

| Method / path                          | İşlev                              | Deneysel |
| -------------------------------------- | ---------------------------------- | -------- |
| GET `/api/v3/info/categories`          | Kategori ağacı                     | Hayır    |
| POST `/api/v3/searchByCategories`      | Kategori araması                   | Hayır    |
| POST `/api/v2/search`                  | Metin araması                      | Hayır    |
| POST `/api/v2/searchByIdentity`        | Ürün detayı                        | Hayır    |
| POST `/api/v2/searchSimilarProduct`    | Benzer ürün                        | Hayır    |
| POST `/api/v3/price-history`           | Fiyat serileri                     | Hayır    |
| POST `/api/v2/nearest`                 | Yakın şubeler                      | Evet     |
| GET `/api/v1/categories`               | Market zincirleri                  | Evet     |
| POST `/api/v2/searchAlternative`       | Zincirde alternatifler             | Evet     |
| POST `/api/v1/list/sync`               | Toplu ürün yenileme                | Evet     |
| GET `/AutoSuggestion/Search?words=...` | Adres önerileri (harita kökeni)    | Evet     |
| GET `/ReverseGeocode?Lat=...&Lon=...`  | Koordinattan adres (harita kökeni) | Evet     |

`/api/v1/store`, `/api/v1/generate`, barkod `identityType` ve harita tile veri aracı desteklenmez.

### MCP araç adları

| Grup          | Araçlar                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Keşif         | `market_status`, `market_get_categories`, `market_list_markets`, `market_find_nearby_depots`                                            |
| Ürün          | `market_search_products`, `market_search_by_category`, `market_get_product`, `market_find_similar_products`, `market_find_alternatives` |
| Geçmiş/toplu  | `market_get_price_history`, `market_sync_products`                                                                                      |
| Konum         | `market_geocode_address`, `market_reverse_geocode`                                                                                      |
| Karşılaştırma | `market_compare_product_offers`, `market_compare_basket`                                                                                |

Kaynaklar: `market://guide`, `market://endpoints`, `market://status`.
İstemler: `compare_shopping_list`, `find_best_product_price`, `analyze_price_history`.

## Bağlam

Her ürün çağrısı `latitude`, `longitude`, `distance` (**km**) ve boş olmayan `depots` alır.
Şube kimliği zincir anahtarı + şube ID'sinden oluşan opak string'dir.

1. Verilmiş konum/yarıçap ve ona ait şubeleri kullanın; değişmediyse AI önceki listeyi kullanabilir.
2. Şubeler eksikse yakın şube aracını bir kez çağırın. Elle seçim isteğe bağlıdır.
3. Bağlamı her çağrıya ekleyin. Sunucu konumu hatırlamaz, tahmin etmez veya kapsamı genişletmez.

| Yerel sınır           | Değer                                        |
| --------------------- | -------------------------------------------- |
| Yarıçap / seçili şube | 50 km / 500                                  |
| Sayfa boyutu          | Varsayılan 25, en fazla 100                  |
| Sepet                 | En fazla 5 ürün, retry dâhil 5 HTTP denemesi |
| Miktar                | Ürün başına 50 paket                         |

Bunlar backend kotası veya ban güvenliği garantisi değildir. Etkin sınırları `market_status.limits` verir.
HTTP yalnız Accept ve gerektiğinde Content-Type gönderir; yönlendirmeler engellenir.

**Kapsam dışı teklif korunur.** Ham ürün yanıtları daraltılmaz; `warnings` kapsam dışını açıklar.
Türetilmiş sıralama, `offers`, `unavailableOffers`, gruplar ve `splitBasket` yalnız seçili `depots` içindir.
Dış teklifler `data.outOfScopeOffers=[{productId,offer}]` içinde ham alan, harita ve değerlendirme
referanslarıyla kalır; hesaplara girmez. Seçili teklif yoksa en ucuz fiyat/tam sepet toplamı null'dır.

## Kategori ve arama

### Filtreyi kurun

| İşlem                 | Girdi / davranış                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Kategori ağacı        | `{content:[{id,parentId,name,children:[]}]}`; ID number, parentId number/null, özyinelemeli ağaç; ek alanlar korunur |
| Yerel kategori seçimi | `query` Türkçe harf kurallarıyla filtreler; `parentId` düğümün çocuklarını seçer; `flat` düzleştirir                 |
| Metin araması         | `{keywords,pages,size,...filters,...context}`                                                                        |
| Kategori araması      | `menu_category`, `main_category`, `sub_category` alanlarından en az biri; Türkçe isim dizileri, ID/slug değil        |
| Diğer filtreler       | `market_names`, `brand`, `refined_quantity_unit`, `refined_volume_weight`, `offer_price`, `offer_discount`           |

Filtre değerlerini kategori ağacı/facetMap'ten alın. Yanıt facet'i `offer_market`, istekte `market_names` olur.
Gramajı metne yazmak kesin filtre değildir. Bilinen filtre ve sıralamayı tek aramada birleştirin:

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

Konum/şube örnektir: gerçek konum kullanıcıdan, şube ID'si o konumun API yanıtından gelmelidir.

- Fiyat aralıkları: `10-50`, `100-*`, `100+`.
- İndirim filtresi: `["true"]` veya alanı atlama.
- Sıralama: `order.name=lowest_price|offer_unit_price`, `order.type=asc|desc`; varsayılan için `order` atlanır.
- UI alanı `price_range` API'ye gönderilmez.

### Sayfalama ve eşleşme

Yanıt: `{numberOfFound,searchResultType,content:[Product],facetMap}`. `facetMap` null olabilir.

| Durum                      | Anlam                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `pages=0`                  | İlk sayfa; her çağrı bir sayfa alır, otomatik tarama yok                                            |
| `meta.pagination.nextPage` | Sonraki çağrılabilir sayfa                                                                          |
| Son endeks `10000`         | Daha fazla eşleşme olabilirse `nextPage:null` + `PAGINATION_LIMIT_REACHED`; tam kapsam kanıtı değil |
| `numberOfFound`            | Toplam eşleşme; sayfa veya şube stok sayısı değil                                                   |
| `searchResultType=2/3`     | Bulanık arama uyarısı; 0'a özel anlam atanmaz                                                       |

Toplam, dönen ürün sayısından veya dolu sayfanın offset'i + ürün sayısından küçükse `INVALID_RESPONSE`.
Boş geç sayfa otomatik ek sorgu üretmez. Önceki yanıt açıklama için kullanılırsa özgün `retrievedAt` belirtilir.

### İndirim işaretini koruyun

| `discount` | Yorum                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| `true`     | API indirimli işaretlemiş; kampanya/üyelik uygunluğu doğrulanmış değil                  |
| `false`    | API indirimli işaretlememiş; filtre kullanıldı diye teklif elenmez/yeniden etiketlenmez |
| Eksik      | Bilinmiyor                                                                              |

İndirim filtresi üst `warnings` içinde belirsizlik uyarısı üretir; ürün işaretini geçersiz kılmaz.
`discountlessPrice` geçmiş satış kanıtı değildir. Referans fiyat/oran/promosyon metni boolean'ın
yerine geçmez; fiyat farkından indirim yüzdesi üretilmez. False + yüksek referans fiyat otomatik çelişki sayılmaz.
Kesin şartlar korunur; açıklayıcı tercihler yakın alternatifleri erkenden elememeli.
Ayrıntılı karar kaynağı `market://guide`'dır.

## Ürün ve teklifler

| İşlem      | Girdi                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Detay      | `{identity,identityType:"id",pages:0,size:1,...context}`; kimlik string, baştaki sıfırlar korunur |
| Benzer     | `{id,keywords,pages,size,...context}`; keywords için ürün başlığı                                 |
| Alternatif | Ek `marketName`; yalnız bu zincirin şube ID'leri                                                  |

Benzerlik eşdeğerlik değildir. Aramadaki teklifler yeterliyse ek detay çağırmayın;
eksik bilgi/fiyat yenilemesi gerektiğinde çağırın. Ürün karşılaştırması detayı kendisi alır,
sepet her ürün için ayrıca detay sorgular; aynı detayı iki kez istemeyin.

Detay (karşılaştırmalar dâhil) ve sync: beklenmeyen/yinelenen ürün ID'si `INVALID_RESPONSE`;
boş yanıt geçerli. Sync eksik ID'leri `meta.missingProductIds` verir. Bu iki uçta `nextPage` daima null;
otomatik ikame veya erişilemeyen sayfa önerisi yoktur.

**Product:** `id`, `title`, `productDepotInfoList` zorunlu. İsteğe bağlı alanlar:
`brand`, `imageUrl`, `refinedVolumeOrWeight`, `refinedQuantityUnit`, `categories`,
`menu_category`, `main_category`, `sub_category`. Eksik resim/gramaj ve ek alanlar korunur.
Boş/whitespace `marketAdi` tüm yanıtı geçersiz kılar; geçerli değer trim edilmez.

| Alan                          | Anlam                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| depotId / depotName           | Fiziksel şube kimliği ve adı                                              |
| marketAdi                     | Zincir anahtarı                                                           |
| price                         | Paket fiyatı, TRY                                                         |
| unitPrice / unitPriceValue    | Metin ve sayısal birim fiyat                                              |
| latitude / longitude          | Şube koordinatları                                                        |
| indexTime                     | Upstream güncelleme etiketi; zaman dilimi varsayılmaz                     |
| percentage                    | İndirim oranı olarak kullanılmaz                                          |
| discount                      | API indirim işareti: true/false; alan eksikse bilinmiyor                  |
| discountlessPrice             | Ham referans fiyat; geçmişte gerçekleşmiş satış fiyatı olduğu varsayılmaz |
| discountRatio / promotionText | Nullable indirim oranı / promosyon metni                                  |
| maps                          | MCP'nin ürettiği `{google,apple,yandex}` HTTPS linkleri veya `null`       |

`retrievedAt` sorgunun tamamlandığı andır; `indexTime` için zaman dilimi varsayılmaz.
Fiyat farkı teklif karşılaştırmasıdır, kampanya yüzdesi değildir. Promosyon alanları stok/üyelik garantisi vermez.
Geçmiş fiyat serisi geçmiş indirim/referans işaretlerini içermez; sabit seri sürekli indirim etiketi kanıtlamaz.

### Harita bağlantıları

1. Önce şema doğrulanır: null/string koordinat veya yakın şubede eksik `location.lat/lon` → `INVALID_RESPONSE`.
2. Şemadan geçen şube koordinatları kullanılır: sonlu enlem [-90,90], boylam [-180,180].
   Aralık dışı sayılar veya teklifte eksik opsiyonel koordinat → `maps:null`. Tipler sayıya zorlanmaz.
3. URL'ler yerel üretilir; kullanıcının konumu yedek olmaz. Kaynağın `maps` alanı MCP bağlantılarıyla değiştirilir.

| Sağlayıcı | URL şablonu                                                         |
| --------- | ------------------------------------------------------------------- |
| Google    | `https://www.google.com/maps/search/?api=1&query=<enlem,boylam>`    |
| Apple     | `https://maps.apple.com/?ll=<enlem,boylam>&q=<enlem,boylam>`        |
| Yandex    | `https://yandex.com/maps/?ll=<boylam,enlem>&pt=<boylam,enlem>&z=16` |

Parametreler URL-encode edilir. `maps` yakın şubenin her öğesinde ve her `productDepotInfoList`
teklifinde bulunur; karşılaştırma `offers`/`unavailableOffers`, sepet/split `lines[].offer` içinde korunur.
Çok şubeli sepete grup düzeyinde tek link verilmez. Link koordinata işaret koyar; işletme kaydı/rota değildir.
Üretimi ağ/API anahtarı gerektirmez.

Sağlayıcı belgeleri: [Google](https://developers.google.com/maps/documentation/urls/get-started),
[Apple](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html),
[Yandex](https://yandex.com/dev/yandex-apps-launch-maps/doc/en/concepts/yandexmaps-web).

## Fiyat geçmişi

İstek: `{uniqueId,depots,latitude,longitude,distance}`; tercihen ürün tekliflerinde dönen şube ID'leri.
Yanıt: `[{name:<market>,series:[{name:"YYYY-MM-DD",value:<number|null>}]}]`.

| Kural            | Sonuç                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- |
| `value`          | Sonlu, negatif olmayan sayı veya açık null; metin/boolean/nesne/eksik alan reddedilir |
| `from/to`        | Yalnız yerel tarih filtresi; API'ye gönderilmez                                       |
| Sıralama         | Tarihe göre; null noktalar/ek alanlar korunur, hiç dönmeyen günler üretilmez/sayılmaz |
| `summary.points` | Filtre sonrası tüm noktalar; `availablePoints` sayısal, `missingPoints` null          |
| Özet             | İlk/son/min/maks/değişim ve `from/to` yalnız sayısal gözlemlerden                     |

Null eksik gözlemdir, sıfır değildir. Boş aralık boş seri + null istatistik; tümü-null aralık noktaları
korur ama tarih/fiyat/değişim istatistikleri null olur. Filtre içinde null → `HISTORY_MISSING_VALUES`;
filtre dışındaki null uyarı üretmez. Aynı zincirde çoklu şube serilerinin birleşimi bilinmiyor.

Değişim yüzdesi normalize kuruşla hesaplanır; başlangıç sıfırsa/sıfıra yuvarlanırsa null.
Ham ilk/son/min/maks korunur. TRY çıktısında bir kuruş kaybı yaratacak büyüklük → `INVALID_PRICE`;
güvenli integer kuruş tek başına yeterli değildir.

## Market, konum ve toplu sorgu

| İşlem          | Sözleşme                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Market listesi | `content[].marketAdi`, varsa `name/isActive`; hardcoded liste yok                                                                                              |
| Yakın şube     | Gövde `{latitude,longitude,distance}`; yanıt array: `id`, `marketName`, `location.lat/lon`, `distance` (**metre**), opsiyonel `sellerName`; ek alanlar korunur |
| Adres önerisi  | URL-encoded `words`; tuple 0=adres, 7=boylam, 8=enlem. Sonlu sayı/sayısal metin kabul; boolean/array/boş metin reddedilir. Diğer kolonlar `raw`                |
| Ters geocode   | Query **Lat/Lon**; sıra `Mahalle_Adi`, `Yol_Adi`, `KapiNo`, `Ilce_Adi`, `Il_Adi`                                                                               |
| Sync           | `{identities,identityType:"id",pages:0,size:<id sayısı>,...context}`; en fazla 100 ID; yanıt `content`                                                         |

Market listesi önceki canlı kayıtlarda HTTP 500 verdi; neden bilinmiyor.
Hata: `HTTP_ERROR`, `status:500`, `endpoint:markets`, `activeStatus:unknown`; başarılı boş liste uydurulmaz.
500 otomatik tekrarlanmaz; aynı başarısız liste sorgusunu yinelemeyin. Bu uç ürün kategori ağacı değildir;
arama/karşılaştırmanın önkoşulu olmaz ve hatası diğer araçları durdurmaz.
Ürünlerde görülen zincir adları tam liste/aktiflik garantisi değildir.

Sync sepet bütçesini aşmak veya büyük canlı deneme yapmak için kaçış yolu değildir.
Sepet açık ID'leri bireysel sorgular; eksik ürün başka ID ile doldurulmaz.

## Sepet

**Çağrı öncesi:** `items.length * (retries + 1) <= 5`. `items=[{"id":"ürün-id","quantity":2}]`
ve ortak konum bağlamı gerekir; yinelenen ID reddedilir. Kullanılmayan retry payı diğer ürüne aktarılmaz.

| Retry    | Etkin ürün sınırı |
| -------- | ----------------- |
| 0        | 5                 |
| 1        | 2                 |
| 2 veya 3 | 1                 |

Şema sınırı 5: aşım SDK giriş hatası veya `INVALID_ARGUMENT`.
Retry bütçesi aşımı: `REQUEST_BUDGET_EXCEEDED`, ayrıntıda `maxHttpAttempts/maxItems`.
Her iki durumda da ürün sorgusu başlamaz. Bölerek/araç değiştirerek aşmak yasaktır.
Kontrol çağrı başınadır; oturum/global/IP kotası değildir.

### Toplamı okuyun

- `groupBy=market`: zincirde en ucuz teklifler; birden fazla şube gerekebilir.
- `groupBy=depot`: fiziksel şubeler ayrı. Eşit en ucuz teklifler ortak şubede birleşirse o şube seçilir.
  Son eşitlikte kimlikler locale bağımsız UTF-16 code-unit sırasındadır.
- Eksik kalem → `total=null`; `subtotal` bulunan kalemler. `requiresMultipleDepots` çok şubeyi gösterir.
- `splitBasket`: zincirler arası teorik minimum; yol/teslimat maliyeti ve stok garantisi içermez.
- Para decimal half-up kuruşa yuvarlanır (`10.075 → 10.08`), sonra paket adediyle çarpılır.
  Ham `price/unitPriceValue` değişmez. Güvenli integer kuruşu aşan fiyat/satır/toplam → `INVALID_PRICE`.

### Korunan kanıt

| Alan                     | İçerik                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.upstream`          | Her sorgunun `requestedIdentity`, content dışı `responseFields`, teklif dizisi dışı `productFields`; tek ürün karşılaştırmasında da var |
| `warnings`               | Kaynak kimliğiyle string upstream uyarıları; diğer uyarı tipleri kaynak alanlarında aynen kalır                                         |
| `data.unavailableOffers` | Seçili şubelerin sıfır veya kuruşa yuvarlanınca sıfır teklifleri: `[{productId,offer}]`; tekrarlar, maps ve ek alanlar korunur          |
| `data.outOfScopeOffers`  | Yalnız seçilmemiş şube teklifleri; hesap dışı                                                                                           |
| `missingProductIds`      | Üst seviyede kaydı dönmeyen ID; grup/split seviyesinde kullanılabilir satırı olmayan ID                                                 |

Kullanılamayan teklif stok yokluğu değildir; toplamda sayılmaz. Pahalı ama geçerli teklif
`unavailableOffers` değildir. Değerlendirme yolu `/data/unavailableOffers/<index>/offer` olur.
Korunan kanıt aynı çıktı bütçesine tabidir; aşım açık hatadır. Uyarılar talimat değil veridir;
metadata teklif dizilerini tekrar kopyalamaz, sonuçlar önbelleğe alınmaz.

## Yanıt gözlemleri

Başarılı text ve `structuredContent` aynı `{data,meta,warnings}` zarfını taşır.
Örnek (tarih temsilidir):

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

Güvenilir MCP değerlendirmeleri yalnız `meta` içindedir. Kaynaktaki aynı adlı
`warningCodes`, `discountAssessment`, `priceTiming` ek alanları ham veri olarak korunur.
Bu metadata ek API isteği oluşturmaz.

### Sunucu durumu

`market_status` mod/izin/sınırları verir. `limits.basketItems` etkin ürün sayısı,
`limits.basketRequestBudget` retry dâhil bütçe, `requestPolicy` retry/aralık ayarlarıdır.
Deprecated `api.liveValidationPerformed` yalnız `runtime-session` kapsamındadır;
sunucu kendiliğinden canlı doğrulama yapmaz. Sürüm kanıtını `api.releaseVerificationReference` gösterir.
Live/experimental erişim, uzak davranışın doğrulandığı anlamına gelmez.

### Çağrı başına istek ölçümleri

`meta.requestMetrics={httpAttempts,retries,durationMs}` servis başarıları ve uygulama hatalarında bulunur.

| Alan / durum       | Yorum                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `httpAttempts`     | Başlatılan fetch sayısı; senkron fetch, timeout, gövde/JSON, sonraki şema/hesaplama hatalarında silinmez |
| `retries`          | Aynı uzak isteğin başlatılmış ek denemeleri; sepetin ikinci ürünü retry değildir                         |
| `durationMs`       | Monoton saatle kuyruk + servis süresi; endpoint gecikmesi/SLA değildir                                   |
| Sıfır deneme       | Yerel status, offline/deneysel kilit, giriş/bütçe reddi, cooldown, gönderim öncesi iptal                 |
| Kısmi sepet hatası | Önce tamamlanan ürünlerin denemeleri de sayılır                                                          |

Sayaçlar eşzamanlı çağrılarda ayrıdır; yanıt anlık kopyadır. Teslim, güvenli kota veya bansız çalışma
kanıtlamaz. Toplam oturum bütçesini AI izler. SDK handler öncesi giriş reddinde zarf/ölçüm olmayabilir;
eksik metadata'yı yapılmış HTTP isteği saymayın.

### Şube kapsamı

Altı ürün endpoint'i ve iki karşılaştırmada `meta.depotCoverage` bulunur:

| Alan                                   | Anlam                                                          |
| -------------------------------------- | -------------------------------------------------------------- |
| `basis`                                | Her zaman `returned_offers`; facet verisinden çıkarım yapılmaz |
| `requestedDepotIds` / `requestedCount` | İstenen benzersiz şubeler ve sayısı                            |
| `returnedDepotIds` / `returnedCount`   | Teklif dönen tüm benzersiz şubeler; kapsam dışı olanlar dâhil  |
| `returnedRequestedCount`               | İstenen ve teklif dönen kümelerin kesişim sayısı               |
| `unreturnedRequestedDepotIds`          | Bu yanıtta teklif dönmeyen istenmiş şubeler                    |
| `outOfScopeDepotIds`                   | İstenmemiş fakat teklifte görülen şubeler                      |
| `unreturnedStatus`                     | Her zaman `unknown`; stok yok iddiası değildir                 |
| `perProduct`                           | `productId` ile aynı kapsam alanları; iç içe `perProduct` yok  |

- Kapsam yalnız bu sayfa/açık ID'lerdir. Sync/sepet eksik ID'leri `perProduct` içinde boş dönen kümeyle yer alır.
- Sıfır fiyat dönen kanıttır, kullanılabilir fiyat değildir. Tekrar teklifler benzersiz şube sayısını artırmaz.
- Tüm şubelerin bir üründe görünmesi, her üründe görünmesi değildir; `perProduct` okunmalıdır.
- Tüm şubeler görünse de stok/tüm fiyat garantisi yoktur. Facet sayıları fiyat kapsamı değildir.
- Kontrollü canlı örnekte çoklu yanıtta eksik şube, tek-şube sorgusunda teklif döndürdü.
  Bu genel seçim algoritması kanıtı değildir; eksik şubeler otomatik taranmaz.

### İndirim ve fiyat zamanları

`meta.offerAssessments`: her kaynak teklif için `{productId,depotId,offerIndex,discountAssessment,priceTiming}`.
`offerIndex` özgün dizide sıfır tabanlıdır; yalnız seçili satırları değil tüm teklifleri kapsar, ham teklifi kopyalamaz.

| API işareti | `discountAssessment` |
| ----------- | -------------------- |
| `true`      | `unverified`         |
| `false`     | `not_indicated`      |
| Eksik       | `unknown`            |

Referans fiyat, `discountRatio` ve `promotionText` bu sonucu değiştirmez; hiçbir değer kampanyayı doğrulamaz/indirim yüzdesi üretmez.

**23.09.2026 uyumluluk değişikliği:** `inconsistent` ve `DISCOUNT_INCONSISTENT` artık üretilmez.
Eski false/yüksek referans kayıtları `not_indicated` olur. Önceden yalnız referans/oran/metinle
`unverified` sayılanlar artık false ise `not_indicated`, işaret eksikse `unknown` olur.
Metadata, ham teklifler ve diğer üç değer korunur. İstemciler kaldırılan değere/koda bağlı olmamalıdır;
aynı adlı upstream alan/uyarılar ham veri olarak kalır, MCP kodu sayılmaz.

Karşılaştırmalar `meta.offerAssessmentRefs=[{path,assessmentIndex}]` verir.
`path` üst zarfın JSON pointer'ı (ör. `/data/offers/0`, `/data/groups/0/lines/0/offer`),
indeks `meta.offerAssessments` içindir. Sıralanan/kullanılamayan/dış teklifler ve sepet/split satırları
bu yolla eşleşir. Özgün `offerIndex` sıralanmış çıktı indeksi değildir; aynı şubenin tekrar teklifleri ayrılır.

`priceTiming`: ürün sorgusunun `retrievedAt` zamanı, ham `upstreamIndexTime` (eksikse null),
`upstreamTimezone:"unknown"`, `ageMs:null`. Boş/bozuk etiket ayrıştırılmaz/değiştirilmez.
Sepet her ürünün kendi sorgu zamanını korur; fiyat yaşı hesaplanmaz.

### Sabit uyarı kodları

`meta.warningCodes` tekilleştirilmiş MCP kodlarıdır; `warnings` string dizisi korunur.
Upstream metin koda benzese de MCP koduna dönüştürülmez. Hata nedeni `error.code`'dur;
başarısız yanıt önceki kısmi fiyat değerlendirmelerini yayımlamaz, `warningCodes:[]` taşır.

| Kod                           | Koşul / anlam                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `PRICE_SCOPE_LIMITED`         | Ürün fiyatları yalnız dönen tekliflere aittir                                          |
| `DEPOT_AVAILABILITY_UNKNOWN`  | En az bir ürün/şube için istenen teklif dönmemiştir                                    |
| `OUT_OF_SCOPE_OFFERS`         | Seçilmemiş şubeden teklif vardır                                                       |
| `DISCOUNT_FILTER_UNVERIFIED`  | İndirim filtresi kullanılmıştır; kampanya garantisi yoktur                             |
| `PARTIAL_RESULTS`             | Tek arama sayfası tüm eşleşmeleri kapsamıyor; son sayfada da olabilir                  |
| `PAGINATION_LIMIT_REACHED`    | Yerel son sayfa endeksinde daha fazla eşleşme olabilir; `nextPage` null'dır            |
| `SEARCH_MAY_BE_FUZZY`         | Metin araması adaylarının koşulları kontrol edilmelidir                                |
| `UPSTREAM_FUZZY_RESULT`       | Upstream `searchResultType` 2 veya 3                                                   |
| `EXPERIMENTAL_ENDPOINT`       | Başarılı çağrı deneysel uç kullanmıştır                                                |
| `HISTORY_AGGREGATION_UNKNOWN` | Geçmiş serilerinin şubeler arası birleştirilmesi bilinmiyor                            |
| `HISTORY_MISSING_VALUES`      | Seçilen tarih aralığında null fiyatlar var; özetler yalnız sayısal gözlemleri kullanır |
| `UPSTREAM_WARNING`            | Ürün yanıtı/ürünlerde upstream uyarı verisi vardır                                     |
| `BASKET_SCOPE_LIMITED`        | Sepet yalnız açıkça verilen ürün ve konum kapsamındadır                                |

`DEPOT_AVAILABILITY_UNKNOWN`, `PARTIAL_RESULTS`, `PAGINATION_LIMIT_REACHED` açıklayıcı string de ekler.
Tekrarlı upstream stringler kaynak kimliğiyle korunur; kod tekilleştirme ham uyarıları silmez.
Katalog `src/observations.ts` üzerinden `market://guide`'a aktarılır.

## Kaynak kullanım sınırları

**Sınırlar yereldir; API kotası değildir.** `market_status.limits` ile okunur.
Sabit işleme limitleri araç girdisi/ortamla yükseltilmez.

| Sınır                                                | Davranış                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 aktif + 32 bekleyen taşıma isteği                  | FIFO; kapasite aşımında fetch öncesi `QUEUE_FULL`                                                                                              |
| HTTP gövdesi                                         | Her yanıt için `MARKET_FIYATI_MAX_RESPONSE_BYTES`; aşım `RESPONSE_TOO_LARGE`                                                                   |
| Çağrı başına toplam girdi                            | Kaynakların kompakt JSON UTF-8 boyutlarının toplamı aynı byte sınırına tabidir; sepette kaynaklar birikir                                      |
| 500.000 JSON değeri, derinlik 64                     | Kaynaklar toplamında değer sayısı; her kaynakta kök derinliği 0; şema klonlamadan önce denetlenir                                              |
| 100 ürün kaydı                                       | Altı ürün endpoint’inde çağrı başına toplam `content` uzunluğu; teklifsiz ürünler dâhil; şube kapsamı metadata’sı üretilmeden denetlenir       |
| 10.000 teklif                                        | Çağrıdaki kaynak `content[].productDepotInfoList` uzunluklarının toplamı; dış/sıfır teklifler dâhil                                            |
| 128 upstream uyarı girdisi, 65.536 byte string uyarı | Yanıt/ürün `warnings` alanlarında çağrı başına toplam; scalar bir girdidir; string byte hesabı JSON tırnak ve escape karakterlerini içerir     |
| 8 MiB çıktı zarfı                                    | Kompakt JSON UTF-8; text serileştirmesi ve structuredContent çoğaltması öncesi denetlenir; ayrıca 2.000.000 değer ve derinlik 80 sınırı vardır |

### Hata çıktısı

| Hata                      | Davranış                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `RESOURCE_LIMIT_EXCEEDED` | Girdi/uyarı/teklif bütçesi aşıldı                                                       |
| `OUTPUT_TOO_LARGE`        | Çıktı bütçesi aşıldı; büyük/geçersiz hata tanılaması da sabit bu zarfa dönüşür          |
| Kaynak sınırı             | Ayrıntıda `resource`, `limit`; `isError=true`, `data:null`, boş `warnings/warningCodes` |
| `INVALID_RESPONSE`        | Yalnız güvenilir endpoint ayrıntısı; upstream path/anahtar/değer tanılamaya kopyalanmaz |

Kısmi fiyat veya kırpılmış kaynak alanı başarı diye verilmez. Kabul edilen ek alan/uyarılar korunur.
Bütçe dolunca sonraki sepet sorgusu başlamaz; önceki denemeler hata metadata'sında kalır.
Hata zarfı da çıktı bütçesine tabidir; geçerli sonlu sayaçlar korunur.

Kontroller uyarı prefiksleri, şema kopyaları, harita ve değerlendirmeler üretilmeden yapılır.
JSON boyutu tam string/anahtar-değer dizisi üretmeden artımlı sayılır.
**8 MiB zarf, JSON-RPC mesaj sınırı değildir:** text + structuredContent ve escape nedeniyle mesaj
küçük protokol alanlarıyla birlikte yaklaşık üç katına çıkabilir.

### Retry, kuyruk ve iptal

- Varsayılan retry 0, seri aralık 1 saniye. HTTP 500, timeout, ağ hatası ve sıradan 4xx tekrarlanmaz.
- 429/502/503/504 için geçerli Retry-After, aynı kökeni retry bütçesi bitse de bekletir.
  5 saniyeyi aşan beklemede erken deneme yapılmaz; hata iletilir. Kuyruktaki çağrı süre dolmadan
  gönderilmez, kalan `retryAfterMs` döner. API/harita beklemesi ayrıdır; süre dolunca normal istek mümkündür.
- Bekleyen iptal FIFO kaydını/dinleyicisini hemen kaldırır, kapasiteyi boşaltır ve sonradan fetch başlatmaz.
  Aktif iptal, seri aralık ve retry/sepet bütçeleri korunur.
- JSON-RPC kimliği yanıtına kadar izlenir. Sayısal `0`/boş string iptali çalışır;
  yinelenen aktif kimlik reddedilir, tamamlanan kimlik yeniden kullanılabilir. Kapanış kayıtları iptal eder/siler.
- MCP SDK varsayılan istek süresi 60 saniyedir; istemci değiştirebilir. HTTP timeout tek denemeye aittir.
  Sunucu ilerleme bildirimi üretmez. Küçük sepet de yavaş upstream'de istemci süresini aşabilir.

İstemci cancellation veya stdio kapanışı aktif/bekleyen işleri iptal eder.
Gerçek istemcinin timeout/Stop kabulü yalnız sentetik gecikme ve sahte fetch ile yapılır;
uzun/büyük sepet, canlı yük/süre/kota keşif testleri yapılmaz.

### Diğer hata kodları

Uygulama hataları `isError=true` ve `error.code` taşır; SDK giriş hataları yalnız MCP metni olabilir.
`NETWORK_DISABLED`, `EXPERIMENTAL_DISABLED`, `INVALID_ARGUMENT`, `HTTP_ERROR`, `RATE_LIMITED`,
`TIMEOUT`, `CANCELLED`, `RESPONSE_TOO_LARGE`, `QUEUE_FULL`, `INVALID_PRICE` ve
`REQUEST_BUDGET_EXCEEDED` ilgili koşulu bildirir. Ham hata gövdesi dışarı verilmez.
