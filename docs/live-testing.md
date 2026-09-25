# Gerçek fiyatlarla canlı test

Bu rehber npm paketini bir MCP istemcisinde gerçek API yanıtlarıyla denemek içindir. Node.js 22+
ve stdio MCP destekleyen bir istemci gerekir. Kaynak kodu klonlamak veya test paketini kurmak gerekmez.
Offline mod bağlantıyı doğrular; ürün ve fiyat sorguları live modda çalışır.

Live çağrı yalnızca kullanıcı testi açıkça başlattığında ve
[sağlayıcı izinleri](../README.md#amaç-ve-kullanım-izinleri) netleştiğinde yapılır.
Kullanıcının onay vermesi, API veya veri kullanım izni yerine geçmez. Emin değilseniz offline modda kalın.

## 1. İstemciyi live modda bağlayın

İstemcinizin MCP sunucu ayarına şu yapılandırmayı ekleyin. Mevcut `market-fiyati` kaydınız varsa onu
güncelleyin; aynı sunucuyu iki kez eklemeyin. Ayar dosyasının yeri ve üst yapısı istemciye göre değişebilir.

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "npx",
      "args": ["-y", "market-fiyati-mcp@1.0.6"],
      "env": {
        "MARKET_FIYATI_MODE": "live",
        "MARKET_FIYATI_LATITUDE": "0",
        "MARKET_FIYATI_LONGITUDE": "0",
        "MARKET_FIYATI_DISTANCE": "2",
        "MARKET_FIYATI_ENABLE_EXPERIMENTAL": "false",
        "MARKET_FIYATI_RETRIES": "0"
      }
    }
  }
}
```

**Yukarıdaki `0,0` sentetik örnektir; canlı sorgudan önce kendi seçtiğiniz koordinatlarla değiştirin.**
Env değerleri string, ondalık ayırıcı nokta, distance kilometredir. Üç konum değişkenini birlikte
ayarlayın veya üçünü de kaldırıp her çağrıda sağlayın. Eksik env kurulumu sunucuyu başlatmaz.
Bu destek 1.0.6 ile gelir; npm yayını henüz tamamlanmadıysa kaynak checkout üzerinden deneyin.
Kesin koordinatları proje dışında, istemcinin özel yapılandırmasında tutun.

İstemciden MCP sunucusunu yeniden başlatın; gerekiyorsa istemciyi kapatıp açın. Terminalde ortam
değişkeni ayarlamak, zaten çalışan masaüstü istemcisinin sunucu ayarını değiştirmez.
`npx` bulunamazsa istemcinin çalıştırabildiği mutlak `npx` yolunu kullanın.

## 2. Bağlantıyı ve modu doğrulayın

AI'a şunu yazın:

> `market_status` çağır. Modu, live erişimini ve deneysel erişimin açık olup olmadığını göster.
> `market://guide` resource'unu oku; henüz veri sorgusu yapma.

**Beklenen:** `data.mode=live`, `data.liveRequestsEnabled=true`,
`data.experimentalEndpointsEnabled=false`, yukarıdaki env kurulumu için
`data.locationDefaults.configured=true`. Status koordinatları göstermez. Başlangıç, status ve resource okuma API isteği göndermez;
bu adım tek başına gerçek fiyat erişiminin başarılı olduğunu kanıtlamaz.

## 3. Test konumunu ve şubeleri belirleyin

Env yapılandırıldıysa AI'a “Ayarlı konumu ve yarıçapı kullan” deyin; koordinatları yeniden yazmanız
gerekmez. AI, konum alanlarını atlayarak env değerlerini kullanır. Env yoksa enlem, boylam ve km
yarıçapını birlikte çağrıya ekleyin; örtük 1 km varsayımı yoktur. Başka konum için enlem ve boylamı
birlikte verin; distance belirtilmezse ayarlı env yarıçapı kullanılır. Bu değişiklik yalnız o çağrı içindir.

Yalnız adres biliyorsanız deneysel erişim açıkken `market_geocode_address` ile bir kez çözümleyin.
Belirsiz adaylar arasından kullanıcı seçim yapar; yarıçapı kullanıcı sağlar. Koordinatları tahmin etmeyin.
Örnek koordinatları gerçek sorguya taşımayın; kesin konumu Git'e veya rapora eklemeyin.

- **Konuma ait şube kimlikleri biliniyorsa:** Bunları boş olmayan `depots` listesi olarak kullanın.
  Deneysel erişimi açmak gerekmez; market zinciri adı şube kimliği yerine geçmez.
- **Şube kimlikleri bilinmiyorsa:** Yukarıdaki ayarda `MARKET_FIYATI_ENABLE_EXPERIMENTAL` değerini
  `true` yapın ve sunucuyu yeniden başlatın. Status ile ayarı doğruladıktan sonra AI'a şunu yazın:

> Env’de ayarlı veya verdiğim enlem, boylam ve yarıçapla `market_find_nearby_depots` tool'unu bir kez çağır.
> Dönen şubeleri ve kimliklerini göster; sonraki aramada bu şubeleri kullan. Sonuç boşsa dur.

Şubeleri elle daraltmak isteğe bağlıdır. Kimlikleri uydurmayın; gerçek yanıttan alın.
`market_list_markets` ilk arama için gerekli değildir. Deneysel erişim izni, endpoint'in çalıştığına dair kanıt değildir.

## 4. Tek ürün aramasıyla fiyat erişimini test edin

Şubeler belirlendikten sonra AI'a şunu yazın:

> Env’de ayarlı veya verdiğim konumu, yarıçapı ve belirlediğimiz şubeleri kullanarak `market_search_products` çağır.
> `keywords="süt"`, `pages=0`, `size=5` olsun. Yalnızca bir arama yap; ek sayfa, ürün detayı veya
> otomatik tekrar çağrısı yapma. Dönen ürün adlarını, gramajlarını, seçili şubelerdeki TRY fiyatlarını,
> sorgu zamanını ve uyarıları göster. Eksik bilgiyi tahmin etme.

Bu başlangıç akışı, retry kapalıyken bir arama HTTP denemesi; şube keşfi de gerekiyorsa toplam iki
veri isteği denemesi içerir. Adres çözümleme de gerekiyorsa bir deneme daha eklenir. Bunlar sağlayıcının kota garantisi değildir. Sonuçta bulunan offer'ları
kullanın; aynı fiyatları açıklamak için tekrar detay çağrısı yapmayın.

**Geçme ölçütü:** Arama uygulama hatası vermeden tamamlanır ve seçili şubelerde dönen gerçek fiyatlar,
ürün/gramaj bilgisi ve uyarılar istemcide doğru gösterilir. Boş sonuç veya şube teklifi eksikliği
“stok yok” anlamına gelmez ve fiyat erişiminin kabulü olarak kaydedilmez. İlk sayfa tüm ürünleri kapsamaz.

## 5. Sonucu kontrol edin ve oturumu kapatın

| Gözlenen durum                                 | Yapılacak işlem                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK_DISABLED`                             | Sunucunun ortam ayarında `MARKET_FIYATI_MODE=live` olduğunu kontrol edin; yeniden başlatıp status okuyun.                          |
| `EXPERIMENTAL_DISABLED`                        | Şube keşfi gerekiyorsa operatör deneysel erişimi açıp yeniden başlatsın; bilinen şubelerle normal arama için gerekmez.             |
| Girdi doğrulama hatası                         | Enlem/boylamı, km yarıçapını ve boş olmayan gerçek `depots` listesini kontrol edin; hata metnindeki alanı düzeltin.                |
| HTTP 429/403/5xx veya `TIMEOUT`                | Otomatik tekrar yapmayın. HTTP durumu ve varsa bekleme bilgisini gösterin; erişim veya servis sorununu çözmeden testi sürdürmeyin. |
| Boş sonuç, eksik fiyat veya `INVALID_RESPONSE` | Başarı ya da stok sonucu uydurmayın. Güvenli hata özetini kaydedin; yanıt sözleşmesi hatasını ayrıca inceleyin.                    |

Test sonunda yalnız istemci/sürüm, paket sürümü, tarih, denenen işlem ve güvenli sonuç özetini kaydedin.
Kesin konumu, token'ları ve ham yanıtları proje dışında tutun. Kullanıcının tercihine göre
`MARKET_FIYATI_MODE=offline` yapıp sunucuyu yeniden başlatın; status ile kapandığını doğrulayın.

## Geliştiriciler için daha kapsamlı kabul

Aşağıdaki adımlar kaynak kodu değiştiren ve endpoint kapsamını sınayan geliştiriciler içindir;
yukarıdaki npm başlangıcı için ön koşul değildir.

### Hazırlık

1. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.
2. İstemcide `market_status` tool'uyla modun offline olduğunu doğrulayın.
3. `market://guide` ve `market://endpoints` resource'larını okuyun. Kullanıcının konumunu, yarıçapı ve bu
   konuma ait bilinen şubeleri belirleyin. Eksikleri not edin; henüz uzak sorgu yapmayın.

**Hazır sayılır:** Kontroller geçti, context biliniyor, live test ve sağlayıcı izinleri net.

### Küçük live kabul testi

Bu adımlar yalnızca izin alındıktan sonra yapılır:

1. Operatör ortamında `MARKET_FIYATI_MODE=live` ayarlayın ve sunucuyu yeniden başlatın. Önce
   `market_status` okuyun; sunucunun başlaması istek göndermez. Şubeler bilinmiyorsa operatör deneysel
   erişimi açtıktan sonra yakındaki şubeleri bir kez sorgulayın. Şubeleri elle seçmek isteğe bağlıdır.
2. Ürün türü, gramaj ve sıralamayı bilinen API filtreleriyle tek bir aramada birleştirin. Filtre değerleri
   bilinmiyorsa önce kategorileri ve facet'leri keşfedin. Sonuç sayısını ve sayfa kapsamını kontrol edin.
3. Bir ürünün ID'sini ve gramajını doğrulayın. Endpoint'leri ayrı ayrı test etmek için ürün detayı, benzer
   ürünler ve fiyat geçmişi alın. Normal kullanımda arama sonucundaki offer'lar yeterliyse detay çağrısına
   gerek olmayabilir.
4. Kategori, fiyat, gramaj ve indirim filtrelerini ayrı ayrı kontrol edin.
5. `limits.basketItems` değeri iki ürüne izin veriyorsa küçük bir sepeti önce zincir bazında
   (`groupBy=market`), sonra şube bazında (`groupBy=depot`) karşılaştırın.
   **Beklenen sonuç:** Eksik ürün varsa `total=null` olur; farklı şubeler tek bir mağazaymış gibi sunulmaz.

Her ürün çağrısına şubeleri açıkça ekleyin; konum ve yarıçap env’den veya çağrıdan eksiksiz gelmelidir. Retry ayarı açıksa iki ürünlük bir sepet
bile bütçeyi aşabilir.

### Gerekirse deneysel endpoint'ler

Operatör `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` ayarlar. Gereken endpoint'leri sırayla deneyin: market
listesi, geocode ve ters geocode, yakındaki şubeler, toplu ürün yenileme ve alternatifler.

Yanıtları [API sözleşmesiyle](api.md) karşılaştırın. Beklenenden farklı bir biçimi tahmine dayanarak
dönüştürmeyin; şemayı güncelleyin ve bunun için sentetik bir regresyon testi ekleyin.

## Sınırlar

- **Uzun veya büyük sepet, yük, süre ve kota keşfi live yapılmaz.** Listeyi küçük çağrılara bölmek veya sync
  endpoint'ine geçmek bu yasağı ortadan kaldırmaz.
- Timeout, Stop ve uzun bekleme davranışları [sentetik kabul kitiyle](offline-acceptance.md) test edilir;
  orada gerçek ağ erişimi engellidir.
- SDK üzerindeki 5 ürün, bütçe ve iptal testleri, gerçek masaüstü istemcinin kabul testi yerine geçmez.
- Küçük live örneklerden güvenli bir kota sonucu çıkarmayın; kapsamı ve bütçeyi ayrıca belirleyin. Eksik bir
  sepeti tamamlanmış gibi göstermeyin.

## Kabul sonucunu kaydetme

1. HTTP 429 yanıtını ve bekleme süresini kullanıcıya gösterin.
2. Yalnızca denenen işlemi, endpoint'i, sürümü, tarihi ve gözlenen sonucu kaydedin. Kesin konumu, token'ları
   ve kişisel header'ları rapora eklemeyin.
3. Test bitince kullanıcının tercihine göre offline moda dönün.

**Geçme ölçütü:** Dönen fiyatlar, zincir ile şube ayrımı ve belirsizlikler gerçek istemcide doğru sunuldu.
Bu kabul, denenmemiş endpoint'ler veya daha büyük yükler için geçerli sayılmaz.
