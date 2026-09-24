# API sözleşmesi

**Yaptığınız çağrıyla ilgili bölümü okuyun. Filtre ve kimlik değerlerini her zaman API yanıtından alın.**

Bu belge, bağımsız bir MCP uygulamasının sözleşmesidir. Sağlayıcının resmî belgesi değildir ve kullanım izni
vermez. [Kullanım izinleri](../README.md#amaç-ve-kullanım-izinleri) · [Doğrulama sınırı](verification.md).

## Endpoint'ler

Kullanılan sabit adresler: `https://api.marketfiyati.org.tr` ve `https://harita.marketfiyati.org.tr/Service/api/v1`.

Katalogda **12 endpoint** vardır ve bunların **6'sı deneyseldir**. `market://endpoints` resource'unu okumak
ağ isteği yapmaz. Deneysel endpoint'lere erişmek için ortam değişkeniyle izin verilmesi gerekir. Hiçbir
endpoint için uzak sunucunun davranışı garanti edilmez.

| Method ve path                         | Ne işe yarar                         | Deneysel |
| -------------------------------------- | ------------------------------------ | -------- |
| GET `/api/v3/info/categories`          | Kategori ağacı                       | Hayır    |
| POST `/api/v3/searchByCategories`      | Kategoriye göre arama                | Hayır    |
| POST `/api/v2/search`                  | Metinle arama                        | Hayır    |
| POST `/api/v2/searchByIdentity`        | Ürün detayı                          | Hayır    |
| POST `/api/v2/searchSimilarProduct`    | Benzer ürünler                       | Hayır    |
| POST `/api/v3/price-history`           | Fiyat geçmişi serileri               | Hayır    |
| POST `/api/v2/nearest`                 | Yakındaki şubeler                    | Evet     |
| GET `/api/v1/categories`               | Market zincirleri                    | Evet     |
| POST `/api/v2/searchAlternative`       | Bir zincirdeki alternatif ürünler    | Evet     |
| POST `/api/v1/list/sync`               | Ürünleri toplu yenileme              | Evet     |
| GET `/AutoSuggestion/Search?words=...` | Adres önerileri (harita sunucusu)    | Evet     |
| GET `/ReverseGeocode?Lat=...&Lon=...`  | Koordinattan adres (harita sunucusu) | Evet     |

`/api/v1/store` ve `/api/v1/generate` endpoint'leri, barkod türündeki `identityType` ve harita tile
verisi desteklenmez.

### MCP tool adları

| Grup            | Tool'lar                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Keşif           | `market_status`, `market_get_categories`, `market_list_markets`, `market_find_nearby_depots`                                            |
| Ürün            | `market_search_products`, `market_search_by_category`, `market_get_product`, `market_find_similar_products`, `market_find_alternatives` |
| Geçmiş ve toplu | `market_get_price_history`, `market_sync_products`                                                                                      |
| Konum           | `market_geocode_address`, `market_reverse_geocode`                                                                                      |
| Karşılaştırma   | `market_compare_product_offers`, `market_compare_basket`                                                                                |

Resource'lar: `market://guide`, `market://endpoints`, `market://status`.
Prompt'lar: `compare_shopping_list`, `find_best_product_price`, `analyze_price_history`.

## Context

Her ürün çağrısı şu alanları alır: `latitude`, `longitude`, `distance` (**km** cinsinden) ve boş olmayan bir
`depots` listesi. Şube kimliği, zincir anahtarı ile şube ID'sinden oluşan opak bir string'dir.

1. Kullanıcının verdiği konumu, yarıçapı ve bu konuma ait şubeleri kullanın. Bunlar değişmediyse AI önceki
   şube listesini yeniden kullanabilir.
2. Şubeler bilinmiyorsa yakındaki şubeleri bulan tool'u bir kez çağırın. Şubeleri elle seçmek isteğe bağlıdır.
3. Context'i her çağrıya ekleyin. Sunucu konumu hatırlamaz, tahmin etmez ve arama kapsamını kendiliğinden
   genişletmez.

| Yerel sınır            | Değer                                            |
| ---------------------- | ------------------------------------------------ |
| Yarıçap / seçilen şube | En fazla 50 km / en fazla 500 şube               |
| Sayfa boyutu           | Varsayılan 25, en fazla 100                      |
| Sepet                  | En fazla 5 ürün; retry'lar dâhil 5 HTTP denemesi |
| Miktar                 | Ürün başına en fazla 50 paket                    |

Bu sınırlar backend kotası değildir ve erişimin engellenmeyeceğini garanti etmez. Geçerli sınırları `market_status.limits`
gösterir. HTTP isteklerinde yalnızca `Accept` header'ı ve gerektiğinde `Content-Type` gönderilir.
Yönlendirmeler (redirect) engellenir.

**Kapsam dışındaki offer'lar silinmez.** Ham ürün yanıtları seçili şubelere göre kırpılmaz; kapsam dışı
offer'lar `warnings` içinde açıklanır. Buna karşılık MCP'nin türettiği sıralama, `offers`, `unavailableOffers`,
gruplar ve `splitBasket` yalnızca seçili `depots` için üretilir.

Seçilmemiş şubelerin offer'ları `data.outOfScopeOffers=[{productId,offer}]` içinde; ham alanları, harita
linkleri ve değerlendirme referanslarıyla birlikte tutulur, ama hiçbir hesaba katılmaz. Seçili şubelerde hiç
offer yoksa en ucuz fiyat ve tam sepet toplamı `null` olur.

## Kategori ve arama

### Filtreyi kurma

| İşlem                 | Girdi ve davranış                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kategori ağacı        | `{content:[{id,parentId,name,children:[]}]}` biçimindedir. `id` sayıdır, `parentId` sayı veya `null` olur; ağaç iç içedir (özyinelemeli). Ek alanlar korunur.          |
| Yerel kategori seçimi | `query`, Türkçe büyük/küçük harf kurallarıyla filtreler. `parentId` bir düğümün alt kategorilerini seçer. `flat` ağacı düz listeye çevirir.                            |
| Metinle arama         | `{keywords,pages,size,...filtreler,...context}`                                                                                                                        |
| Kategoriye göre arama | `menu_category`, `main_category` ve `sub_category` alanlarından en az biri verilmelidir. Değerler Türkçe kategori adlarından oluşan dizilerdir; ID veya slug değildir. |
| Diğer filtreler       | `market_names`, `brand`, `refined_quantity_unit`, `refined_volume_weight`, `offer_price`, `offer_discount`                                                             |

Filtre değerlerini kategori ağacından veya yanıttaki `facetMap`'ten alın. Yanıttaki `offer_market` facet'i,
istekte `market_names` alanına karşılık gelir. Gramajı arama metnine yazmak kesin bir filtre değildir.
Bilinen filtreleri ve sıralamayı tek bir aramada birleştirin:

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

Buradaki konum ve şube yalnızca örnektir. Gerçek konum kullanıcıdan, şube ID'si ise o konum için dönen API
yanıtından gelmelidir.

- Fiyat aralığı örnekleri: `10-50`, `100-*`, `100+`.
- İndirim filtresi: `["true"]` verin ya da alanı hiç göndermeyin.
- Sıralama: `order.name` değeri `lowest_price` veya `offer_unit_price`, `order.type` değeri `asc` veya `desc`
  olur. Varsayılan sıralama için `order` gönderilmez.
- Arayüzdeki `price_range` alanı API'ye gönderilmez.

### Sayfalama ve eşleşme

Yanıt biçimi: `{numberOfFound,searchResultType,content:[Product],facetMap}`. `facetMap` `null` olabilir.

| Durum                         | Anlamı                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pages=0`                     | İlk sayfadır. Her çağrı yalnızca bir sayfa getirir; otomatik olarak diğer sayfalar taranmaz.                                          |
| `meta.pagination.nextPage`    | Çağrılabilecek bir sonraki sayfa                                                                                                      |
| Son sayfa endeksi `10000`     | Daha fazla eşleşme olabilecekse `nextPage:null` ve `PAGINATION_LIMIT_REACHED` döner. Bu, tüm sonuçların görüldüğünün kanıtı değildir. |
| `numberOfFound`               | Toplam eşleşme sayısıdır; sayfadaki ürün sayısı veya şubedeki stok sayısı değildir.                                                   |
| `searchResultType=2` veya `3` | Bulanık (fuzzy) arama uyarısı üretir. `0` değerine özel bir anlam yüklenmez.                                                          |

Toplam eşleşme sayısı, dönen ürün sayısından ya da dolu bir sayfanın offset'i ile ürün sayısının toplamından
küçükse `INVALID_RESPONSE` hatası döner. İleri bir sayfanın boş gelmesi otomatik ek sorgu başlatmaz. Önceki
bir yanıt açıklama için kullanılıyorsa o yanıtın özgün `retrievedAt` değeri belirtilir.

### İndirim işaretini koruma

| `discount` | Yorumu                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `true`     | API ürünü indirimli olarak işaretlemiştir. Kampanyaya veya üyeliğe uygunluk doğrulanmış değildir.                         |
| `false`    | API ürünü indirimli olarak işaretlememiştir. İndirim filtresi kullanıldı diye bu offer elenmez veya yeniden etiketlenmez. |
| Alan yok   | Bilinmiyor                                                                                                                |

İndirim filtresi, yanıtın üst düzey `warnings` alanına bir belirsizlik uyarısı ekler; ürünlerdeki işareti
değiştirmez. `discountlessPrice`, ürünün geçmişte bu fiyattan satıldığının kanıtı değildir. Referans fiyat,
indirim oranı veya promosyon metni `discount` boolean'ının yerine geçmez ve fiyat farkından indirim yüzdesi
hesaplanmaz. `discount=false` iken referans fiyatın yüksek olması otomatik olarak çelişki sayılmaz.

Kullanıcının kesin şartları korunur; ancak açıklayıcı tercihler yakın alternatifleri erkenden elemek için
kullanılmamalıdır. Ayrıntılı karar kuralları `market://guide` resource'undadır.

## Ürün ve offer'lar

| İşlem      | Girdi                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Detay      | `{identity,identityType:"id",pages:0,size:1,...context}`. Kimlik bir string'dir; baştaki sıfırlar korunur. |
| Benzer     | `{id,keywords,pages,size,...context}`. `keywords` olarak ürün başlığı verilir.                             |
| Alternatif | Bunlara ek olarak `marketName` alır; `depots` yalnızca bu zincirin şube ID'lerinden oluşmalıdır.           |

Benzer bir ürün, aynı ürün anlamına gelmez. Arama sonucundaki offer'lar yeterliyse ayrıca detay çağırmayın;
bilgi eksikse veya fiyatın yenilenmesi gerekiyorsa çağırın. Ürün karşılaştırması detayı kendisi alır; sepet
ise her ürün için ayrı bir detay sorgusu yapar. Aynı detayı iki kez istemeyin.

Detay (karşılaştırmalar dâhil) ve sync endpoint'lerinde beklenmeyen veya tekrar eden bir ürün ID'si
`INVALID_RESPONSE` hatası verir; boş yanıt ise geçerlidir. Sync, bulunamayan ID'leri
`meta.missingProductIds` içinde listeler. Bu iki endpoint'te `nextPage` her zaman `null`'dır. Eksik ürünün
yerine otomatik olarak başka ürün konmaz ve erişilemeyen bir sayfa önerilmez.

**Product:** `id`, `title` ve `productDepotInfoList` zorunludur. İsteğe bağlı alanlar: `brand`, `imageUrl`,
`refinedVolumeOrWeight`, `refinedQuantityUnit`, `categories`, `menu_category`, `main_category`,
`sub_category`. Resim veya gramaj eksik olabilir; eksik alanlar ve ek alanlar olduğu gibi korunur.
`marketAdi` boşsa veya yalnızca boşluk karakterlerinden oluşuyorsa tüm yanıt geçersiz sayılır. Geçerli bir
değerin başındaki ve sonundaki boşluklar kırpılmaz.

| Alan                              | Anlamı                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| `depotId` / `depotName`           | Fiziksel şubenin kimliği ve adı                                       |
| `marketAdi`                       | Zincir anahtarı                                                       |
| `price`                           | Paket fiyatı (TRY)                                                    |
| `unitPrice` / `unitPriceValue`    | Birim fiyatın metin ve sayı hali                                      |
| `latitude` / `longitude`          | Şubenin koordinatları                                                 |
| `indexTime`                       | Upstream'in güncelleme etiketi; zaman dilimi varsayılmaz              |
| `percentage`                      | İndirim oranı olarak kullanılmaz                                      |
| `discount`                        | API'nin indirim işareti: `true` veya `false`; alan yoksa bilinmiyor   |
| `discountlessPrice`               | Ham referans fiyat; ürünün geçmişte bu fiyattan satıldığı varsayılmaz |
| `discountRatio` / `promotionText` | `null` olabilen indirim oranı ve promosyon metni                      |
| `maps`                            | MCP'nin ürettiği `{google,apple,yandex}` HTTPS linkleri veya `null`   |

`retrievedAt`, sorgunun tamamlandığı andır. `indexTime` için bir zaman dilimi varsayılmaz. İki offer
arasındaki fiyat farkı bir karşılaştırmadır; kampanya yüzdesi değildir. Promosyon alanları stok veya üyelik
koşulu için garanti vermez. Fiyat geçmişi serileri geçmişteki indirim veya referans fiyat işaretlerini
içermez; fiyatın uzun süre sabit kalması, sürekli bir indirim etiketi olduğunu kanıtlamaz.

### Harita linkleri

1. Önce şema doğrulanır. Koordinat `null` veya string ise ya da yakındaki şubeler yanıtında
   `location.lat/lon` eksikse `INVALID_RESPONSE` hatası döner.
2. Şema doğrulamasından geçen şube koordinatları kullanılır. Enlem [-90, 90], boylam [-180, 180] aralığında
   sonlu bir sayı olmalıdır. Sayılar aralık dışındaysa veya offer'daki isteğe bağlı koordinat eksikse
   `maps:null` olur. Değerler sayıya zorla çevrilmez.
3. URL'ler yerelde üretilir; kullanıcının konumu yedek olarak kullanılmaz. Kaynaktan gelen bir `maps` alanı
   varsa MCP'nin ürettiği linklerle değiştirilir.

| Sağlayıcı | URL şablonu                                                         |
| --------- | ------------------------------------------------------------------- |
| Google    | `https://www.google.com/maps/search/?api=1&query=<enlem,boylam>`    |
| Apple     | `https://maps.apple.com/?ll=<enlem,boylam>&q=<enlem,boylam>`        |
| Yandex    | `https://yandex.com/maps/?ll=<boylam,enlem>&pt=<boylam,enlem>&z=16` |

Parametreler URL-encode edilir. `maps` alanı yakındaki şubeler yanıtının her öğesinde ve her
`productDepotInfoList` offer'ında bulunur. Karşılaştırmalarda `offers` ve `unavailableOffers` içinde, sepet ve
bölünmüş sepette `lines[].offer` içinde korunur. Birden fazla şubeye yayılan bir sepet için grup düzeyinde tek
bir link verilmez. Link yalnızca koordinata işaret koyar; işletme kaydı veya rota değildir. Linkleri üretmek
için ağ erişimi veya API anahtarı gerekmez.

Sağlayıcı belgeleri: [Google](https://developers.google.com/maps/documentation/urls/get-started),
[Apple](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html),
[Yandex](https://yandex.com/dev/yandex-apps-launch-maps/doc/en/concepts/yandexmaps-web).

## Fiyat geçmişi

İstek: `{uniqueId,depots,latitude,longitude,distance}`. Şube ID'leri olarak tercihen ürün offer'larında dönen
ID'leri kullanın.

Yanıt: `[{name:<market>,series:[{name:"YYYY-MM-DD",value:<number|null>}]}]`.

| Kural            | Sonuç                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `value`          | Sonlu ve negatif olmayan bir sayı ya da açıkça `null` olmalıdır. Metin, boolean, nesne veya eksik alan reddedilir.            |
| `from` / `to`    | Yalnızca yerel tarih filtresidir; API'ye gönderilmez.                                                                         |
| Sıralama         | Noktalar tarihe göre sıralanır. `null` noktalar ve ek alanlar korunur; API'nin hiç döndürmediği günler üretilmez ve sayılmaz. |
| `summary.points` | Filtreden sonra kalan tüm noktalar. `availablePoints` sayısal olanları, `missingPoints` `null` olanları sayar.                |
| Özet             | İlk, son, en düşük, en yüksek, değişim ve `from`/`to` değerleri yalnızca sayısal gözlemlerden hesaplanır.                     |

`null`, eksik bir gözlemdir; sıfır anlamına gelmez. Boş bir tarih aralığında seri boş ve istatistikler `null`
olur. Tüm değerleri `null` olan bir aralıkta noktalar korunur, ancak tarih, fiyat ve değişim istatistikleri
`null` olur. Seçilen aralıkta `null` değer varsa `HISTORY_MISSING_VALUES` uyarısı döner; aralık dışındaki
`null` değerler uyarı üretmez. Aynı zincirdeki birden fazla şubenin serilerinin nasıl birleştirildiği
bilinmiyor.

Değişim yüzdesi, kuruşa normalize edilmiş değerlerle hesaplanır. Başlangıç değeri sıfırsa veya kuruşa
yuvarlanınca sıfır oluyorsa yüzde `null` olur. Ham ilk, son, en düşük ve en yüksek değerler korunur. TRY
çıktısında bir kuruşluk kayba yol açacak kadar büyük bir değer `INVALID_PRICE` hatası verir; kuruş değerinin
güvenli bir tam sayı olması tek başına yeterli değildir.

## Market, konum ve toplu sorgu

| İşlem             | Sözleşme                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Market listesi    | `content[].marketAdi` ve varsa `name` ile `isActive` döner. Kodda sabit bir market listesi yoktur.                                                                                                                           |
| Yakındaki şubeler | İstek gövdesi `{latitude,longitude,distance}`. Yanıt bir dizidir: `id`, `marketName`, `location.lat/lon`, `distance` (**metre** cinsinden) ve isteğe bağlı `sellerName`. Ek alanlar korunur.                                 |
| Adres önerisi     | `words` URL-encode edilir. Yanıttaki her satırda 0. sütun adres, 7. sütun boylam, 8. sütun enlemdir. Sonlu sayı veya sayısal metin kabul edilir; boolean, dizi ve boş metin reddedilir. Diğer sütunlar `raw` içinde tutulur. |
| Ters geocode      | Query parametreleri **Lat** ve **Lon**'dur. `display_name` şu alanlardan bu sırayla oluşturulur: `Mahalle_Adi`, `Yol_Adi`, `KapiNo`, `Ilce_Adi`, `Il_Adi`.                                                                   |
| Sync              | `{identities,identityType:"id",pages:0,size:<ID sayısı>,...context}`. En fazla 100 ID alır; yanıt `content` içinde döner.                                                                                                    |

Market listesi endpoint'i önceki live kayıtlarda HTTP 500 döndürdü; nedeni bilinmiyor. Bu durumda hata
`HTTP_ERROR`, `status:500`, `endpoint:markets` ve `activeStatus:unknown` olarak döner; başarılı ama boş bir
liste uydurulmaz. HTTP 500 otomatik olarak tekrar denenmez; aynı başarısız sorguyu tekrarlamayın. Bu
endpoint ürün kategori ağacı değildir. Arama ve karşılaştırma için ön koşul değildir ve hata vermesi diğer
tool'ları durdurmaz. Ürünlerde görülen zincir adları, tam bir liste olduğu veya bu zincirlerin aktif olduğu
anlamına gelmez.

Sync, sepet bütçesini aşmak veya büyük live denemeler yapmak için bir kaçış yolu değildir. Sepet, açıkça
verilen ID'leri tek tek sorgular; bulunamayan bir ürünün yerine başka bir ID konmaz.

## Sepet

**Çağırmadan önce:** `items.length * (retries + 1) <= 5` koşulu sağlanmalıdır. `items` şu biçimdedir:
`[{"id":"ürün-id","quantity":2}]`. Tüm ürünler için ortak bir konum context'i gerekir. Aynı ID iki kez
verilirse istek reddedilir. Bir ürün için kullanılmayan retry hakkı başka bir ürüne aktarılmaz.

| Retry ayarı | Etkin ürün sınırı |
| ----------- | ----------------- |
| 0           | 5                 |
| 1           | 2                 |
| 2 veya 3    | 1                 |

Şemadaki üst sınır 5 üründür; bu sınırın aşılması SDK giriş hatası veya `INVALID_ARGUMENT` verir. Retry
bütçesinin aşılması `REQUEST_BUDGET_EXCEEDED` hatası verir ve ayrıntıda `maxHttpAttempts` ile `maxItems`
yer alır. Her iki durumda da hiçbir ürün sorgusu başlamaz. Bu sınırı listeyi bölerek veya başka bir tool
kullanarak aşmak yasaktır. Kontrol her çağrı için ayrı yapılır; oturum, global veya IP bazlı bir kota değildir.

### Toplamı okuma

- `groupBy=market`: Her zincirdeki en ucuz offer'lar seçilir. Bu offer'lar için birden fazla şubeye gitmek
  gerekebilir.
- `groupBy=depot`: Fiziksel şubeler ayrı ayrı değerlendirilir. Eşit fiyatlı en ucuz offer'lar ortak bir
  şubede toplanabiliyorsa o şube seçilir. Son eşitlik durumunda kimlikler locale'den bağımsız olarak UTF-16
  code unit sırasına göre dizilir.
- Eksik ürün varsa `total=null` olur; `subtotal` yalnızca bulunan ürünlerin toplamıdır.
  `requiresMultipleDepots`, birden fazla şubeye gitmek gerektiğini gösterir.
- `splitBasket`: Zincirler arasında teorik olarak en düşük toplamı gösterir. Yol veya teslimat maliyetini
  içermez ve stok garantisi vermez.
- Para değerleri önce decimal half-up yöntemiyle kuruşa yuvarlanır (`10.075 → 10.08`), sonra paket adediyle
  çarpılır. Ham `price` ve `unitPriceValue` değişmez. Güvenli tam sayı kuruş sınırını aşan bir fiyat, satır
  veya toplam `INVALID_PRICE` hatası verir.

### Korunan kanıt

| Alan                     | İçerik                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.upstream`          | Her sorgu için `requestedIdentity`, `content` dışındaki yanıt alanları (`responseFields`) ve offer dizisi dışındaki ürün alanları (`productFields`). Tek ürün karşılaştırmasında da bulunur. |
| `warnings`               | Upstream'den gelen string uyarılar, hangi kaynaktan geldikleri belirtilerek eklenir. Diğer türdeki uyarılar kaynak alanlarında olduğu gibi kalır.                                            |
| `data.unavailableOffers` | Seçili şubelerde fiyatı sıfır olan veya kuruşa yuvarlanınca sıfır olan offer'lar: `[{productId,offer}]`. Tekrarlar, `maps` ve ek alanlar korunur.                                            |
| `data.outOfScopeOffers`  | Yalnızca seçilmemiş şubelerin offer'ları; hesaplara katılmaz.                                                                                                                                |
| `missingProductIds`      | Üst düzeyde: API'nin hiç kayıt döndürmediği ID'ler. Grup ve bölünmüş sepet düzeyinde: kullanılabilir satırı olmayan ID'ler.                                                                  |

Kullanılamayan bir offer, stok olmadığı anlamına gelmez; yalnızca toplama katılmaz. Pahalı ama geçerli bir
offer `unavailableOffers` içine girmez. Bu offer'ların değerlendirme yolu `/data/unavailableOffers/<index>/offer`
biçimindedir. Korunan kanıt da aynı çıktı bütçesine tabidir; bütçe aşılırsa açık bir hata döner. Uyarılar
talimat değil, veridir. Metadata offer dizilerini yeniden kopyalamaz ve sonuçlar cache'lenmez.

## Yanıt gözlemleri

Başarılı yanıtlarda hem metin çıktısı hem de `structuredContent` aynı `{data,meta,warnings}` zarfını taşır.
Örnek (tarih yalnızca temsilidir):

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

MCP'nin kendi ürettiği güvenilir değerlendirmeler yalnızca `meta` içindedir. Kaynak veride aynı adla gelen
`warningCodes`, `discountAssessment` ve `priceTiming` gibi ek alanlar ham veri olarak korunur. Bu metadata'yı
üretmek ek API isteği gerektirmez.

### Sunucu durumu

`market_status` modu, izinleri ve sınırları gösterir. `limits.basketItems` etkin ürün sınırını,
`limits.basketRequestBudget` retry'lar dâhil istek bütçesini, `requestPolicy` ise retry ve istek aralığı
ayarlarını verir.

Kullanımdan kaldırılmış (deprecated) `api.liveValidationPerformed` alanı yalnızca `runtime-session`
kapsamındadır; sunucu kendiliğinden live doğrulama yapmaz. Sürümün doğrulama kanıtı
`api.releaseVerificationReference` alanında gösterilir. Live veya deneysel erişimin açık olması, uzak
sunucunun davranışının doğrulandığı anlamına gelmez.

### Çağrı başına istek ölçümleri

`meta.requestMetrics={httpAttempts,retries,durationMs}` alanı hem başarılı servis yanıtlarında hem de
uygulama hatalarında bulunur.

| Alan veya durum    | Yorumu                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `httpAttempts`     | Başlatılan fetch sayısı. Senkron fetch hatası, timeout, yanıt gövdesi veya JSON hatası ya da sonrasındaki şema ve hesaplama hatalarında sıfırlanmaz. |
| `retries`          | Aynı uzak isteğin ek olarak başlatılan denemeleri. Sepetteki ikinci ürünün sorgusu retry sayılmaz.                                                   |
| `durationMs`       | Monoton saatle ölçülen kuyrukta bekleme ve servis süresi. Endpoint gecikmesi veya SLA değildir.                                                      |
| Sıfır deneme       | Yerel durum sorgusu, offline veya deneysel kilit, giriş ya da bütçe reddi, bekleme süresi (cooldown), gönderimden önce iptal                         |
| Kısmi sepet hatası | Hatadan önce tamamlanan ürünlerin denemeleri de sayılır.                                                                                             |

Eşzamanlı çağrıların sayaçları birbirinden ayrıdır; yanıttaki değerler o anın kopyasıdır. Bu ölçümler isteğin
teslim edildiğini, kotanın güvenli olduğunu veya erişimin engellenmeyeceğini kanıtlamaz. Oturum boyunca toplam bütçeyi AI
takip eder. SDK, isteği handler'a ulaşmadan önce reddederse yanıt zarfı ve ölçümler olmayabilir; metadata'nın
eksik olmasını HTTP isteği yapılmış gibi yorumlamayın.

### Şube kapsamı

Altı ürün endpoint'inde ve iki karşılaştırma tool'unda `meta.depotCoverage` alanı bulunur:

| Alan                                   | Anlamı                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `basis`                                | Her zaman `returned_offers`'dır; facet verisinden çıkarım yapılmaz.    |
| `requestedDepotIds` / `requestedCount` | İstenen benzersiz şubeler ve sayıları                                  |
| `returnedDepotIds` / `returnedCount`   | Offer dönen tüm benzersiz şubeler (kapsam dışındakiler dâhil)          |
| `returnedRequestedCount`               | Hem istenen hem de offer dönen şubelerin sayısı                        |
| `unreturnedRequestedDepotIds`          | İstenen ama bu yanıtta offer dönmeyen şubeler                          |
| `outOfScopeDepotIds`                   | İstenmediği halde offer'larda görülen şubeler                          |
| `unreturnedStatus`                     | Her zaman `unknown`'dır; stok olmadığı iddia edilmez.                  |
| `perProduct`                           | Her `productId` için aynı kapsam alanları; iç içe `perProduct` yoktur. |

- Kapsam yalnızca bu sayfa veya açıkça verilen ID'ler için geçerlidir. Sync ve sepette bulunamayan ID'ler
  `perProduct` içinde boş bir dönen şube kümesiyle yer alır.
- Sıfır fiyat, offer'ın döndüğünü gösterir ama kullanılabilir bir fiyat değildir. Aynı şubenin tekrar eden
  offer'ları benzersiz şube sayısını artırmaz.
- Tüm şubelerin bir üründe görünmesi, her üründe göründüğü anlamına gelmez; `perProduct` okunmalıdır.
- Tüm şubeler görünse bile stok veya tüm fiyatların alındığı garanti edilmez. Facet sayıları fiyat kapsamını
  göstermez.
- Kontrollü bir live örnekte, çok şubeli bir yanıtta görünmeyen bir şube, tek şubeli sorguda offer döndürdü.
  Bu, API'nin genel seçim algoritması için kanıt değildir; eksik şubeler otomatik olarak taranmaz.

### İndirim ve fiyat zamanları

`meta.offerAssessments`, kaynaktaki her offer için `{productId,depotId,offerIndex,discountAssessment,priceTiming}`
kaydı içerir. `offerIndex`, özgün dizideki sıfırdan başlayan sıradır. Yalnızca seçili satırları değil tüm
offer'ları kapsar ve ham offer'ı kopyalamaz.

| API işareti | `discountAssessment` |
| ----------- | -------------------- |
| `true`      | `unverified`         |
| `false`     | `not_indicated`      |
| Alan yok    | `unknown`            |

Referans fiyat, `discountRatio` ve `promotionText` bu sonucu değiştirmez. Hiçbir değer kampanyayı doğrulamaz
veya indirim yüzdesi üretmek için kullanılmaz.

**23.09.2026 uyumluluk değişikliği:** `inconsistent` değeri ve `DISCOUNT_INCONSISTENT` kodu artık üretilmiyor.
Daha önce `discount=false` ve yüksek referans fiyat nedeniyle bu değeri alan kayıtlar artık `not_indicated`
olur. Daha önce yalnızca referans fiyat, oran veya promosyon metni nedeniyle `unverified` sayılan kayıtlar,
`discount=false` ise `not_indicated`, işaret yoksa `unknown` olur. Metadata, ham offer'lar ve diğer üç değer
aynen korunur. İstemciler kaldırılan değere veya koda bağımlı olmamalıdır. Upstream'den aynı adla gelen alanlar
ve uyarılar ham veri olarak kalır; bunlar MCP kodu sayılmaz.

Karşılaştırmalar ayrıca `meta.offerAssessmentRefs=[{path,assessmentIndex}]` alanını verir. `path`, üst
düzey yanıt zarfı içindeki bir JSON pointer'dır (örneğin `/data/offers/0` veya
`/data/groups/0/lines/0/offer`); `assessmentIndex` ise `meta.offerAssessments` içindeki sıradır. Sıralanmış,
kullanılamayan ve kapsam dışı offer'lar ile sepet ve bölünmüş sepet satırları bu yolla eşleştirilir. Özgün
`offerIndex`, sıralanmış çıktıdaki sıra değildir; aynı şubenin tekrar eden offer'ları birbirinden ayrılır.

`priceTiming` şunları içerir: ürün sorgusunun `retrievedAt` zamanı, ham `upstreamIndexTime` değeri (yoksa
`null`), `upstreamTimezone:"unknown"` ve `ageMs:null`. Boş veya bozuk bir etiket ayrıştırılmaz ve
değiştirilmez. Sepette her ürün kendi sorgu zamanını korur; fiyatın ne kadar eski olduğu hesaplanmaz.

### Sabit uyarı kodları

`meta.warningCodes`, tekrarları ayıklanmış MCP uyarı kodlarını içerir; `warnings` string dizisi de ayrıca
korunur. Upstream'den gelen bir metin bir koda benzese bile MCP koduna dönüştürülmez. Hatanın nedeni
`error.code` alanındadır. Başarısız bir yanıt, daha önce hesaplanmış kısmi fiyat değerlendirmelerini
yayımlamaz ve `warningCodes:[]` taşır.

| Kod                           | Koşul ve anlamı                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `PRICE_SCOPE_LIMITED`         | Ürün fiyatları yalnızca dönen offer'lara aittir.                                            |
| `DEPOT_AVAILABILITY_UNKNOWN`  | En az bir ürün veya şube için istenen offer dönmemiştir.                                    |
| `OUT_OF_SCOPE_OFFERS`         | Seçilmemiş bir şubeden offer gelmiştir.                                                     |
| `DISCOUNT_FILTER_UNVERIFIED`  | İndirim filtresi kullanılmıştır; kampanya garantisi yoktur.                                 |
| `PARTIAL_RESULTS`             | Tek bir arama sayfası tüm eşleşmeleri kapsamıyor; son sayfada da görülebilir.               |
| `PAGINATION_LIMIT_REACHED`    | Yerel son sayfa endeksine ulaşıldı ve daha fazla eşleşme olabilir; `nextPage` `null`'dır.   |
| `SEARCH_MAY_BE_FUZZY`         | Metin aramasında dönen adayların koşulları ayrıca kontrol edilmelidir.                      |
| `UPSTREAM_FUZZY_RESULT`       | Upstream `searchResultType` değeri 2 veya 3'tür.                                            |
| `EXPERIMENTAL_ENDPOINT`       | Başarılı çağrı deneysel bir endpoint kullanmıştır.                                          |
| `HISTORY_AGGREGATION_UNKNOWN` | Fiyat geçmişi serilerinin şubeler arasında nasıl birleştirildiği bilinmiyor.                |
| `HISTORY_MISSING_VALUES`      | Seçilen tarih aralığında `null` fiyatlar var; özetler yalnızca sayısal gözlemleri kullanır. |
| `UPSTREAM_WARNING`            | Ürün yanıtında veya ürünlerde upstream uyarı verisi vardır.                                 |
| `BASKET_SCOPE_LIMITED`        | Sepet yalnızca açıkça verilen ürünleri ve konumu kapsar.                                    |

`DEPOT_AVAILABILITY_UNKNOWN`, `PARTIAL_RESULTS` ve `PAGINATION_LIMIT_REACHED` kodları `warnings` dizisine
açıklayıcı bir metin de ekler. Tekrar eden upstream metinleri, kaynakları belirtilerek korunur; kodların
tekilleştirilmesi ham uyarıları silmez. Kod kataloğu `src/observations.ts` dosyasından `market://guide`
resource'una aktarılır.

## Kaynak kullanım sınırları

**Bu sınırlar yereldir; API kotası değildir.** Geçerli değerleri `market_status.limits` gösterir. Sabit
işleme sınırları tool girdisiyle veya ortam değişkeniyle yükseltilemez.

| Sınır                                                | Davranış                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 aktif + 32 bekleyen transport isteği               | İstekler FIFO sırasıyla işlenir. Kapasite doluysa fetch başlamadan `QUEUE_FULL` döner.                                                                                                                                             |
| HTTP yanıt gövdesi                                   | Her yanıt için `MARKET_FIYATI_MAX_RESPONSE_BYTES` sınırı geçerlidir; aşılırsa `RESPONSE_TOO_LARGE` döner.                                                                                                                          |
| Çağrı başına toplam girdi                            | Bir çağrıdaki tüm kaynak yanıtlarının kompakt JSON UTF-8 boyutlarının toplamı aynı byte sınırına tabidir. Sepette bu boyutlar ürünler boyunca birikir.                                                                             |
| 500.000 JSON değeri, derinlik 64                     | Değer sayısı tüm kaynak yanıtları üzerinden toplanır. Derinlik her kaynakta kökten (0) başlayarak sayılır. Kontrol, şema için veri kopyalanmadan önce yapılır.                                                                     |
| 100 ürün kaydı                                       | Altı ürün endpoint'inde çağrı başına toplam `content` uzunluğu. Offer'ı olmayan ürünler de sayılır. Kontrol, şube kapsamı metadata'sı üretilmeden önce yapılır.                                                                    |
| 10.000 offer                                         | Çağrıdaki kaynak yanıtlarında `content[].productDepotInfoList` uzunluklarının toplamı. Kapsam dışı ve sıfır fiyatlı offer'lar da sayılır.                                                                                          |
| 128 upstream uyarı girdisi, 65.536 byte string uyarı | Yanıt ve ürün düzeyindeki `warnings` alanlarının çağrı başına toplamı. Dizideki her öğe bir girdi, dizi olmayan bir `warnings` değeri ise tek girdi sayılır. String byte hesabına JSON tırnakları ve escape karakterleri dâhildir. |
| 8 MiB çıktı zarfı                                    | Kompakt JSON UTF-8 olarak ölçülür. Kontrol, metin çıktısı üretilmeden ve `structuredContent` çoğaltılmadan önce yapılır. Ayrıca 2.000.000 değer ve 80 derinlik sınırı vardır.                                                      |

### Hata çıktısı

| Hata                      | Davranış                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `RESOURCE_LIMIT_EXCEEDED` | Girdi, uyarı veya offer bütçesi aşıldı.                                                                         |
| `OUTPUT_TOO_LARGE`        | Çıktı bütçesi aşıldı. Çok büyük veya geçersiz hata tanılamaları da bu sabit zarfa dönüştürülür.                 |
| Kaynak sınırı hataları    | Ayrıntıda `resource` ve `limit` bulunur; `isError=true`, `data:null`, `warnings` ve `warningCodes` boştur.      |
| `INVALID_RESPONSE`        | Yalnızca güvenilir endpoint bilgisini içerir. Upstream'deki path, anahtar veya değerler tanılamaya kopyalanmaz. |

Kısmi fiyatlar veya kırpılmış kaynak alanları başarılı sonuç gibi sunulmaz. Kabul edilmiş ek alanlar ve
uyarılar korunur. Bütçe dolunca sepetteki bir sonraki sorgu başlamaz; önceki denemeler hata metadata'sında
kalır. Hata zarfı da çıktı bütçesine tabidir; geçerli ve sonlu sayaçlar korunur.

Bu kontroller; uyarı önekleri, şema kopyaları, harita linkleri ve değerlendirmeler üretilmeden önce yapılır.
JSON boyutu, tüm string'i veya anahtar-değer dizisini oluşturmadan artımlı olarak hesaplanır.

**8 MiB zarf sınırı, JSON-RPC mesaj sınırı değildir.** Mesaj hem metin çıktısını hem de `structuredContent`'i
taşıdığı ve escape karakterleri eklendiği için, küçük protokol alanlarıyla birlikte yaklaşık üç katına
çıkabilir.

### Retry, kuyruk ve iptal

- Varsayılan retry sayısı 0, art arda istekler arasındaki süre 1 saniyedir. HTTP 500, timeout, ağ hataları ve
  sıradan 4xx yanıtları tekrar denenmez.
- 429, 502, 503 veya 504 yanıtıyla gelen geçerli bir `Retry-After`, retry bütçesi bitmiş olsa bile aynı
  sunucuya (origin) giden istekleri bekletir. Bekleme 5 saniyeden uzunsa erken deneme yapılmaz ve hata iletilir.
  Kuyruktaki bir çağrı bu süre dolmadan gönderilmez; kalan süre `retryAfterMs` olarak döner. API ve harita
  sunucularının beklemeleri birbirinden ayrıdır. Süre dolunca normal istekler yeniden gönderilebilir.
- Kuyrukta bekleyen bir istek iptal edilirse FIFO kaydı ve dinleyicisi hemen kaldırılır, kapasite boşalır ve
  sonradan fetch başlatılmaz. Aktif bir isteğin iptalinde de istekler arası süre ile retry ve sepet
  bütçeleri korunur.
- JSON-RPC istek kimliği, yanıt verilene kadar izlenir. Sayısal `0` veya boş string kimlikli isteklerin
  iptali de çalışır. Aktif bir kimlik tekrar kullanılırsa reddedilir; tamamlanmış bir kimlik yeniden
  kullanılabilir. Bağlantı (transport) kapanınca kayıtlar iptal edilir ve silinir.
- MCP SDK'nin varsayılan istek süresi 60 saniyedir ve istemci bunu değiştirebilir. HTTP timeout ise tek bir
  denemeye aittir. Sunucu ilerleme (progress) bildirimi göndermez. Upstream yavaşsa küçük bir sepet bile
  istemcinin süre sınırını aşabilir.

İstemcinin iptal (cancellation) göndermesi veya stdio bağlantısının kapanması, aktif ve bekleyen tüm işleri
iptal eder. Gerçek istemcinin timeout ve Stop davranışı yalnızca sentetik gecikme ve fake fetch ile test
edilir. Uzun veya büyük sepet testleri ile live yük, süre ve kota keşfi yapılmaz.

### Diğer hata kodları

Uygulama hataları `isError=true` ve `error.code` alanlarını taşır; SDK giriş hataları yalnızca MCP hata
metninden oluşabilir. `NETWORK_DISABLED`, `EXPERIMENTAL_DISABLED`, `INVALID_ARGUMENT`, `HTTP_ERROR`,
`RATE_LIMITED`, `TIMEOUT`, `CANCELLED`, `RESPONSE_TOO_LARGE`, `QUEUE_FULL`, `INVALID_PRICE` ve
`REQUEST_BUDGET_EXCEEDED` kodları adlarındaki koşulu bildirir. Ham hata gövdesi dışarıya verilmez.
