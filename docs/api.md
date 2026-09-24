# API sözleşmesi

Bu belge bağımsız MCP uygulamasının teknik sözleşmesini açıklar; sağlayıcının
resmî geliştirici dokümantasyonu veya API kullanım izni değildir.
[Amaç ve kullanım izinleri](../README.md#amaç-ve-kullanım-izinleri) ayrıca geçerlidir.

Sunucu yalnız sabit API kökenlerine erişir:
`https://api.marketfiyati.org.tr` ve
`https://harita.marketfiyati.org.tr/Service/api/v1`.
Canlı doğrulama kapsamı [doğrulama notlarında](verification.md) yer alır.
Deneysel uçlar ayrı ortam ayarı gerektirir; normal uçlar için de uzak davranış
garantisi verilmez.

## Endpoint'ler

Katalog 12 uzak endpoint içerir; bunların 6 tanesi deneyseldir.

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

`/api/v1/store`, `/api/v1/generate` ve barkod identityType desteklenmez.
Harita tile'ları veri aracı değildir. Endpoint kataloğu `market://endpoints`
kaynağından okunabilir; okuma ağ isteği üretmez.

## Bağlam

Upstream seçilmemiş bir şubeden teklif döndürürse teklif verisi korunur ve
`warnings` kapsam dışı şubeler için açık uyarı taşır. Böyle bir yanıttaki tüm
tekliflerin istenen kapsam içinde olduğu iddia edilmemelidir.
Ürün/sepet karşılaştırmalarının sıralaması, `offers`, `unavailableOffers`, grupları
ve `splitBasket` hesapları yalnız çağrıdaki `depots` kümesini kullanır. Dış teklifler
`data.outOfScopeOffers=[{productId,offer}]` içinde ham alanları ve harita bağlantılarıyla
korunur; fiyat veya toplam hesabına girmez. Hiç seçili teklif yoksa en ucuz fiyat ve
tam sepet toplamı null olur. Bu dış teklifler de değerlendirme referansları taşır.

Ürün istekleri `latitude`, `longitude`, `distance` (km) ve `depots` alır. Şube
kimlikleri zincir anahtarı ve şube ID'sinden oluşan opak string'lerdir. MCP kullanıcı
konumunu veya şubeleri hatırlamaz; AI bunları her çağrıda verir. Konum/yarıçap
değişmediyse AI elindeki şube listesini tekrar kullanabilir. Şubeler henüz bilinmiyorsa
yakın şube aracıyla alınır; kullanıcının elle seçim yapması gerekmez. Araçlar konumu
tahmin etmez, verilen kapsamı kendiliğinden genişletmez.

Yerel sınırlar: 50 km yarıçap, sayfada 100 sonuç, 500 seçili şube, sepette en fazla
5 ürün ve retry dâhil 5 HTTP denemesi, ürün başına 50 paket. Retry arttığında etkin
ürün sınırı düşer; `market_status.limits` kaynak alınır. Bunlar backend sınırı
veya ban güvenliği iddiası değildir. HTTP istekleri yalnız
Accept ve gerekirse Content-Type header'larını kullanır; yönlendirmeler engellenir.

## Kategori ve arama

429/502/503/504 yanıtlarındaki geçerli `Retry-After` aynı köken için bekleme
durumu oluşturur. Retry bütçesi bitse de kuyruktaki çağrılar süre dolmadan
gönderilmez; kalan `retryAfterMs` ile hata döner. API ve harita kökenlerinin
bekleme süreleri ayrıdır. Süre dolunca normal istek yapılabilir.

Kategori yanıtı `{content:[{id,parentId,name,children:[]}]}`. ID number,
parentId number/null; ağaç recursive'dir. Yerel `query` Türkçe harf kurallarıyla
filtreler, `parentId` o düğümün çocuklarını seçer, `flat` düzleştirir. Ek alanlar korunur.

Metin araması `{keywords,pages,size,...filters,...context}`; kategori araması
`menu_category`, `main_category` veya `sub_category` alanlarından en az birini
ister. Üç seviye Türkçe isim dizileridir; ID/slug yerine isim kullanılır.
Sayfalama sıfırdan başlar. Varsayılan sayfa boyutu 25'tir; otomatik sayfa döngüsü yoktur.
Yerel son sayfa endeksi 10000'dir. Sınırda başka eşleşmeler olabilirse
`meta.pagination.nextPage:null` ve `PAGINATION_LIMIT_REACHED` döner; bu null
tam kapsam kanıtı değildir. Boş geç sayfa otomatik sorgu üretmez.

Diğer filtreler: `market_names`, `brand`, `refined_quantity_unit`,
`refined_volume_weight`, `offer_price`, `offer_discount`. Dizilerin değerlerini
API facet'lerinden alın. Yanıt facet'i `offer_market` istek tarafında
`market_names` olarak gönderilir.

Fiyat filtresi aralıkları `10-50`, `100-*` veya `100+`; indirim yalnız `["true"]`
veya alanı atlama şeklindedir. `order={name:"lowest_price"|"offer_unit_price",
type:"asc"|"desc"}`; varsayılan sıralamada `order` yoktur. UI'ye özgü bir
`price_range` alanı API'ye gönderilmez.

İndirim filtresi, ürünün `discount` işareti ve referans fiyatı arasında
garanti edilmiş eşdeğerlik varsayılmaz; MCP ham değerleri korur.
Filtre kullanımı yanıtın üst `warnings` dizisinde belirsizlik uyarısı üretir;
filtreye eşleşmek ürünün kendi `discount` alanını geçersiz kılmaz. MCP false
teklifleri yerel olarak elemez veya indirimli olarak yeniden etiketlemez.
`discount=false` API'nin teklifi indirimli işaretlemediğini, true işaretlediğini
belirtir; eksik alan bilinmiyor kalır. Referans fiyat/oran/promosyon metni bu
boolean'ın yerine geçmez. False ve yüksek referans fiyat birlikte geldiğinde
otomatik çelişki uyarısı verilmez; fiyat farkından indirim yüzdesi hesaplanmaz.

Yanıt: `{numberOfFound,searchResultType,content:[Product],facetMap}`.
`numberOfFound` toplam eşleşmedir; sayfa veya şube stok sayısı değildir.
Toplam, dönen ürün sayısından küçükse veya sayfalı uçta dolu sayfanın offset'i
ile dönen ürün sayısının toplamından küçükse yanıt `INVALID_RESPONSE` olur.
`facetMap` null olabilir. Sonuç türü 2/3 bulanık arama uyarısı üretir; tür 0'a
özel semantik atanmaz. Arama metnindeki gramaj kesin filtre sayılmaz.

## Ürün ve teklifler

Detay: `{identity,identityType:"id",pages:0,size:1,...context}`. Kimlik string'dir,
baştaki sıfırlar korunur. Benzer ürün: `{id,keywords,pages,size,...context}`;
keywords için ürün başlığını kullanın. Alternatif araması ek `marketName` alır;
yalnız bu zincirin `depots` ID'leri kabul edilir. Benzerlik eşdeğerlik değildir.

Detay (tek ürün/sepet karşılaştırmalarının dahili sorguları dâhil) ve sync
yanıtlarında beklenmeyen veya yinelenen ürün ID'si
`INVALID_RESPONSE` üretir; boş yanıt kabul edilir. Sync eksik kimlikleri
`meta.missingProductIds` içinde bildirir. Bu iki araçta `nextPage` daima null'dır;
otomatik ikame veya erişilemeyen bir sonraki sayfa önerisi yapılmaz.

Product: `id`, `title`, `productDepotInfoList`; isteğe bağlı `brand`, `imageUrl`,
`refinedVolumeOrWeight`, `refinedQuantityUnit`, `categories`, `menu_category`,
`main_category`, `sub_category`. Resim/gramaj eksik olabilir; ek alanlar korunur.
Teklifin `marketAdi` zincir anahtarı boş veya yalnız whitespace olamaz;
geçersizse bütün yanıt `INVALID_RESPONSE` olur. Geçerli kaynak değeri trim edilmez.

Offer alanları:

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

MCP fiyat farkını kendisi hesaplar; verinin belirli stok veya promosyon uygunluğu
anlamına geldiğini varsaymaz. `retrievedAt` canlı sorgunun tamamlandığı andır.
Buradaki fiyat farkı teklif karşılaştırmasıdır; referans fiyattan kampanya yüzdesi
türetilmez. Fiyat geçmişi geçmiş indirim işaretlerini veya referans fiyatlarını
içermez; sabit seri geçmişte sürekli indirim etiketi bulunduğunu kanıtlamaz.

### Harita bağlantıları

Yanıt şeması önce doğrulanır: null/string koordinat veya yakın şubede eksik
`location.lat/lon` alanı `INVALID_RESPONSE` üretir. `maps:null` toleransı şemadan
geçen fakat aralık dışı sayılara ve tekliflerde opsiyonel koordinatların
eksikliğine uygulanır; bilinmeyen tipler sayıya dönüştürülmez.

`maps` alanı yakındaki şubelerin her öğesine ve tüm ürün yanıtlarındaki
`productDepotInfoList` tekliflerine eklenir. Ürün karşılaştırmasının `offers` ve
`unavailableOffers` dizileri ile sepet gruplarının ve `splitBasket` sonucunun
`lines[].offer` nesneleri bu alanı korur. Sepette birden fazla şube olabileceği
için grup düzeyinde tek bir harita bağlantısı üretilmez.

Bağlantılar yalnız şubenin `latitude/longitude` veya yakın şube yanıtındaki
`location.lat/lon` değerlerinden yerel olarak üretilir. Enlem [-90,90], boylam
[-180,180] aralığında sonlu sayı olmalıdır; eksik veya geçersiz koordinatlarda
`maps: null` döner. Kullanıcının konumu yedek koordinat olarak kullanılmaz.
Kaynak yanıttaki olası `maps` alanı yerine MCP kendi bağlantılarını üretir.

- Google: `https://www.google.com/maps/search/?api=1&query=<enlem,boylam>`.
- Apple: `https://maps.apple.com/?ll=<enlem,boylam>&q=<enlem,boylam>`.
- Yandex: `https://yandex.com/maps/?ll=<boylam,enlem>&pt=<boylam,enlem>&z=16`.

Parametreler URL-encode edilir. Bağlantılar koordinata işaret koyar; doğrulanmış
işletme kimliği veya yol tarifi iddiası taşımaz. Üretim sırasında harita
sağlayıcılarına istek yapılmaz ve API anahtarı gerekmez.

Sağlayıcı belgeleri: [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started),
[Apple Map Links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html),
[Yandex Maps web URLs](https://yandex.com/dev/yandex-apps-launch-maps/doc/en/concepts/yandexmaps-web).

## Fiyat geçmişi

Değişim yüzdesi normalize kuruş değerleriyle hesaplanır; başlangıç sıfır kuruşa
yuvarlanıyorsa yüzde null'dır. Ham ilk/son/min/maks fiyatlar aynen korunur.
Sayısal TRY çıktısına dönüşürken bir kuruşu bile kaybedecek büyük tutarlar
`INVALID_PRICE` üretir; güvenli integer kuruş olmak tek başına yeterli değildir.

İstek `{uniqueId,depots,latitude,longitude,distance}`. Yanıt
`[{name:<market>,series:[{name:"YYYY-MM-DD",value:<number|null>}]}]`.
`value` sonlu negatif olmayan sayı veya açık null olabilir; metin, boolean,
nesne ve eksik alan reddedilir. Null eksik gözlemdir, sıfıra çevrilmez.
`from/to` yalnız MCP'de yerel filtre uygulanır; API'ye gönderilmez. Seriler tarih
sırasına sokulur; null noktalar ve ek upstream alanları korunur.
`summary.points` filtre sonrası tüm kayıtları, `availablePoints` sayısal,
`missingPoints` null kayıtları sayar. Özetin `from/to` tarihleri ilk/son sayısal
kayda aittir. İlk/son/min/maks/değişim yalnız sayısal kayıtlardan hesaplanır.
İlk sayısal değer sıfırsa yüzde fark null'dır. Boş aralık boş seri ve null
istatistik üretir; tümü-null aralık noktaları korur, tarih/fiyat/değişim
istatistikleri null olur. Tarih aralığında hiç döndürülmemiş günler üretilmez
ve sayımlara eklenmez. Filtre sonrası null varsa `HISTORY_MISSING_VALUES`
uyarısı vardır; filtre dışındaki null noktalar bu uyarıyı tetiklemez.
Aynı zincirde birden
fazla şubenin geçmişinin nasıl birleştiği bilinmiyor.

## Market, konum ve toplu sorgu

Market listesi yanıtında `content` dizisindeki `marketAdi` ve varsa `name/isActive`
alanları kullanılır. Liste hardcoded değildir.
Önceki canlı kayıtlar `/api/v1/categories` için HTTP 500 gösterir; neden bilinmiyor.
MCP `HTTP_ERROR`, `status:500`, `endpoint:markets`, `activeStatus:unknown` ile
açıklayıcı hata verir; başarılı boş liste uydurmaz. 500 otomatik tekrar edilmez.
Bu uç ürün kategori ağacı `/api/v3/info/categories` değildir. Arama/karşılaştırma
bu listeye bağlı değildir; liste hatası diğer uçları devre dışı bırakmaz.

Yakın şube gövdesi yalnız `{latitude,longitude,distance}`. Beklenen yanıt array;
öğeler `id`, `marketName`, `location.lat/lon`, `distance` (metre), isteğe bağlı
`sellerName` içerir. Ek alanlar korunur.

Adres araması `words` query parametresini URL-encode eder. Beklenen tuple'da
0 adres, 7 boylam, 8 enlemdir. Koordinatlar sonlu sayılar veya sayısal metin
olmalıdır; boolean, array ve boş metin reddedilir. Diğer kolonlar `raw` altında kalır.
Ters geocode **Lat/Lon** query isimlerini kullanır. Adres parçaları
`Mahalle_Adi`, `Yol_Adi`, `KapiNo`, `Ilce_Adi`, `Il_Adi` sırasıyla birleştirilir.

Toplu sorgu `{identities,identityType:"id",pages:0,size:<id sayısı>,...context}`.
En fazla 100 ID; `content` döner. Sepet karşılaştırması açık ID'leri bireysel detay
istekleriyle alır; eksik ürün başka bir ID ile doldurulmaz.
Sync, sepet bütçesi reddedildiğinde otomatik kaçış yolu değildir; büyük canlı
denemeler veya bütçeyi aşmak için kullanılmaz.

## Sepet

Başlamadan `items.length * (retries + 1) <= 5` kontrol edilir. Retry=0/1/2/3 için
etkin ürün sınırları sırasıyla 5/2/1/1'dir. Şema sınırı 5'tir; aşım giriş hatası,
retry nedeniyle bütçe aşımı `REQUEST_BUDGET_EXCEEDED` verir. Hata ayrıntılarında
`maxHttpAttempts` ve `maxItems` bulunur; hiçbir ürün sorgusu başlamaz. Sınırı
küçük çağrılara bölerek veya araç değiştirerek aşmak rehberde yasaktır. Bu kontrol
çağrı başınadır; kullanıcı oturumu veya global/IP istek kotası tutmaz.

Ürün/sepet karşılaştırmaları `meta.upstream` içinde her sorgunun
`requestedIdentity`, `responseFields` (content dışındaki yanıt alanları) ve
`productFields` (teklif dizisi dışındaki ürün alanları) kaydını taşır. Upstream
string uyarılar kaynak kimliğiyle `warnings` içine aktarılır; diğer uyarı biçimleri
kaynak alanlarında aynen kalır. Bunlar güvenilmeyen upstream verisidir, talimat
değildir. Teklif dizileri metadata'da tekrar kopyalanmaz; sonuçlar önbelleğe alınmaz.

Sepet `data.unavailableOffers=[{productId,offer}]` içinde seçili şubelerden
dönen, fiyatı sıfır veya kuruşa yuvarlanınca sıfır olan ham teklifleri korur.
Aynı şubeye ait tekrar kayıtlar ayrı kalır; `maps` ve ek teklif alanları korunur.
Bunlar grupların/splitBasket'in toplamına girmez; stok yokluğu kanıtı değildir.
Kapsam dışı teklifler yalnız `outOfScopeOffers` içindedir. Daha pahalı fakat
kullanılabilir teklifler `unavailableOffers` değildir. Üst `missingProductIds`
ürün kaydı dönmeyen ID'leri, grup/split listeleri kullanılabilir satırı olmayan
ID'leri gösterir. Yeni ham tekliflerin değerlendirme bağlantıları
`/data/unavailableOffers/<index>/offer` yolunu kullanır. Korunan veri de aynı
çıktı bütçesine tabidir; aşımda açık hata döner.

Kuruş bazında her kalemin en düşük geçerli teklifi seçilir. Aynı fiyatlı teklifler
tek şubede birleşebiliyorsa ortak şube tercih edilir. Zincir ve şube grupları ayrıdır.
Son eşitlik çözümünde kimlikler locale'den bağımsız UTF-16 code-unit sırasıyla karşılaştırılır.
Eksik kalemde `total=null`, yalnız bulunanlar için `subtotal`; seçili tekliflerin
birden çok şubeden olması `requiresMultipleDepots` ile görünür. Sıfır fiyat
kullanılabilir sayılmaz. splitBasket zincirler arası teorik minimumdur.

Hesaplanan para değerleri ondalık half-up yöntemiyle en yakın kuruşa yuvarlanır
(`10.075 → 10.08`). Paket fiyatı önce normalize edilir, sonra paket adediyle
çarpılır. Normalize edilmiş fiyatı sıfır kuruş olan teklif kullanılamaz;
ham upstream `price` ve `unitPriceValue` alanları değiştirilmez. Güvenli integer
kuruş sınırını aşan fiyat, satır veya toplam `INVALID_PRICE` üretir.

## Yanıt gözlemleri

Yeni alanların tamamı MCP'nin ürettiği `meta` içindedir; üst zarf ve ham upstream
alanlar değişmez. Verinin içindeki `warningCodes`, `discountAssessment` veya
`priceTiming` adlı ek alanlar varsa korunur; güvenilir MCP değerlendirmesi
yalnız aşağıdaki metadata'dır. Hiçbiri ek API isteği oluşturmaz.

### Çağrı başına istek ölçümleri

`meta.requestMetrics = {httpAttempts, retries, durationMs}` tüm servis başarıları
ve uygulama hatalarında bulunur. `httpAttempts`, HTTP taşıyıcısının fetch çağrısı
başlatma sayısıdır. Senkron fetch hatası, timeout, gövde/JSON hatası ve sonradan
oluşan şema/hesaplama hataları bu sayıyı silmez. `retries` yalnız aynı uzak isteğin
başlatılmış ek denemeleridir; sepetin ikinci ürünü retry sayılmaz.

Yerel status, offline/deneysel kilit, giriş/bütçe reddi, cooldown ve gönderilmeden
iptal edilen çağrılar sıfır denemedir. Sepet hatası önce tamamlanan ürünleri de
kapsar. Eşzamanlı araç çağrılarının sayaçları birbirinden ayrıdır; dönen değerler
anlık kopyadır. `durationMs` monoton saatle ölçülen, kuyruk ve servis işlemleri
dâhil geçen süredir; endpoint gecikmesi veya upstream SLA ölçümü değildir.

Bu bilgi istek teslimini, güvenli kotayı veya ban olmayacağını kanıtlamaz.
Sunucu oturum/IP toplamı saklamaz; çağıran AI anlaşılmış toplam bütçeyi takip eder.
SDK şema denetimi handler'dan önce reddederse uygulama zarfı/ölçümleri olmayabilir.
Bu durumda eksik metadata'yı gerçekleşmiş HTTP isteği gibi yorumlamayın.

### Şube kapsamı

Altı ürün endpoint'inin sonuçlarında ve iki karşılaştırma aracında
`meta.depotCoverage` bulunur:

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

Kapsam, aramanın yalnız bu sayfasına veya açık ID sorgularına aittir.
Sync/sepetin eksik ürünleri de `perProduct` içinde boş dönen şube kümesiyle
gösterilir. Sıfır fiyatlı teklif dönen kanıt sayılır; kullanılabilir fiyat sayılmaz.
Yinelenen teklifler şube sayısını artırmaz. Tüm şubelerin en az bir üründe görünmesi
her ürünün her şubede gözlendiği anlamına gelmez; `perProduct` ayrıca değerlendirilir.
Tüm şubeler görünse bile stok veya tüm fiyatların kapsandığı garanti edilmez.
Kontrollü canlı örnekte çoklu şube yanıtında görünmeyen bir şubenin aynı ürün
teklifi, açık tek-şube sorgusunda döndü. Bu, tüm endpoint'ler için belirli bir
seçim algoritmasını kanıtlamaz. MCP ham şube kapsamını aynen iletir; ürün yanıtlarının tekliflerini daraltmaz.
Türetilmiş karşılaştırmaları seçili şubelerle sınırlar, dış teklifleri ayrı korur
ve eksik şubeler için otomatik ek istek başlatmaz.

### İndirim ve fiyat zamanları

`meta.offerAssessments` her dönen teklif için `{productId, depotId, offerIndex,
discountAssessment, priceTiming}` kaydı içerir. `offerIndex` özgün ürün teklif
dizisinde sıfırdan başlar. Karşılaştırmalarda kayıtlar yalnız seçilmiş satırları
değil tüm kaynak teklifleri kapsar; ham teklifi tekrar kopyalamaz.

İki karşılaştırma aracı ayrıca `meta.offerAssessmentRefs` döndürür. Her
`{path, assessmentIndex}` kaydında `path`, üst yanıttaki teklife giden JSON pointer
(ör. `/data/offers/0` veya `/data/groups/0/lines/0/offer`), `assessmentIndex` ise
`meta.offerAssessments` dizisinin indeksidir. Sıralanmış teklifler, kullanılamayan
teklifler, `outOfScopeOffers[].offer` ve sepet/splitBasket satırları bu bağlantılarla eşleştirilir. Özgün
`offerIndex` sıralama sonrasında çıktı dizisinin indeksi olarak kullanılmaz;
aynı şubenin birden fazla teklifi olsa da kaynak eşleşmesi korunur.

`discountAssessment` değerleri:

- `unverified`: Yalnız `discount=true`; API indirim işareti var, kampanya uygunluğu doğrulanmış değil.
- `not_indicated`: Yalnız `discount=false`; API indirim işareti yok.
- `unknown`: `discount` alanı yok; referans fiyat, oran veya metinden işaret türetilmez.

Bu sınıflandırma yalnız boolean'ı özetler; referans fiyat, `discountRatio` veya
`promotionText` sonucu değiştirmez. Ham değerler korunur; sınıflandırma indirim
yüzdesi türetmez ve hiçbir durum kampanyayı doğrulamaz.

**23.09.2026 uyumluluk değişikliği:** `inconsistent` değerlendirmesi ve
`DISCOUNT_INCONSISTENT` MCP uyarı kodu artık üretilmez. Eski false/yüksek referans
teklifleri `not_indicated` olur. Önceden yalnız referans, oran veya metin nedeniyle
`unverified` olan teklifler false işarette `not_indicated`, eksik işarette
`unknown` olur. `meta.offerAssessments`, `offerAssessmentRefs`, ham teklifler ve
diğer üç değer korunur; istemciler kaldırılan değerin/kodun gelmesine bağlı
olmamalıdır. Aynı ifadeleri taşıyan upstream ek alanları/uyarıları veri olarak
aynen korunur; MCP kodu veya değerlendirmesi sayılmaz.

`priceTiming` alanları: `retrievedAt` ilgili ürün sorgusunun tamamlanma zamanı;
`upstreamIndexTime` ham `indexTime` etiketi veya eksikse null;
`upstreamTimezone:"unknown"`; `ageMs:null`. Boş/bozuk etiketler değiştirilmez,
tarih olarak ayrıştırılmaz. Sepette her ürünün kendi sorgu zamanı korunur.

### Sabit uyarı kodları

`meta.warningCodes` tekilleştirilmiş MCP kodlarıdır; `warnings` string dizisi
geriye uyumludur. Upstream uyarı metni bir koda benzese bile koda dönüştürülmez.
Hata nedenleri mevcut `error.code` alanındadır; başarısız yanıtlar önceki kısmi
başarıların fiyat değerlendirmesini yayımlamaz ve `warningCodes:[]` taşır.

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

`DEPOT_AVAILABILITY_UNKNOWN`, `PARTIAL_RESULTS` ve `PAGINATION_LIMIT_REACHED` için açıklayıcı string uyarı da
eklenir. Tekrarlı upstream uyarı stringleri mevcut kaynak kimlikleriyle korunur;
kodların tekilleştirilmesi ham uyarıları silmez. Kod kataloğu `market://guide`
içinde `src/observations.ts` kaydından yayımlanır.

## Kaynak kullanım sınırları

Sınırlar yereldir; uzak API kotası değildir. `market_status.limits` değerleri
bildirir. Sabit işleme sınırları araç girdisi veya ortam ayarıyla yükseltilmez.

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

Girdi/uyarı/teklif bütçesi aşımı `RESOURCE_LIMIT_EXCEEDED`, çıktı bütçesi aşımı
`OUTPUT_TOO_LARGE` üretir. Kaynak sınırı hataları `resource` ve `limit` taşır;
MCP `isError=true`,
`data:null`, boş warnings ve warningCodes döndürür. Hiçbir kısmi fiyat sonucu veya
kırpılmış upstream alanı başarılı sonuç olarak yayımlanmaz. Kabul edilen veride ek
alanlar ve uyarılar korunur. Bütçesi dolan sepette sonraki ürün sorguları başlamaz;
o ana kadar yapılan HTTP denemeleri hata `meta.requestMetrics` alanında kalır.
Hata zarfı da aynı çıktı bütçesine tabidir. Büyük/geçersiz hata tanılaması sabit
`OUTPUT_TOO_LARGE` zarfına dönüşür; geçerli sonlu sayaçlar korunur. Başarısız
`INVALID_RESPONSE` yalnız güvenilir endpoint ayrıntısını taşır; upstream path,
anahtar ve değerleri tanılamaya kopyalanmaz. Başarılı ek alanlar ve uyarılar korunur.

Uyarı sayısı ve kaynak koleksiyon boyutları prefiksli uyarı dizileri, şema kopyaları,
harita bağlantıları ve değerlendirmeler üretilmeden önce kontrol edilir. JSON
boyutu tam bir JSON string veya anahtar/değer dizisi üretmeden artımlı sayılır.
Çıktı zarfı sınırı tüm MCP mesajının sınırı değildir: aynı zarf text ve
structuredContent olarak taşındığı ve text tekrar escape edildiği için JSON-RPC
mesajı yaklaşık üç katına, küçük protokol alanları eklenerek çıkabilir.

İptal edilen bekleyen istek hemen FIFO'dan çıkarılır, dinleyicisi temizlenir ve
kapasiteyi serbest bırakır; sonradan fetch başlatmaz. Aktif isteğin iptali, seri
aralık, Retry-After köken beklemesi ve retry/sepet bütçeleri korunur.
Gelen JSON-RPC istek kimliği yanıtına kadar geçici olarak izlenir. Sayısal `0` ve
boş string kimlikli araç çağrılarının iptali de çalışır; yinelenen aktif kimlikli JSON-RPC isteği
reddedilir. Tamamlanmış kimlik yeniden kullanılabilir. Bağlantı kapanınca geçici
kayıtlar iptal edilip silinir.
