# Kullanıcıyla live test

**Önce offline kontrolleri çalıştırın.** Live çağrı yalnızca kullanıcı birlikte test etmeyi açıkça
başlattığında ve [sağlayıcı izinleri](../README.md#amaç-ve-kullanım-izinleri) netleştiğinde yapılır.
Kullanıcının onay vermesi, API veya veri kullanım izni yerine geçmez. Emin değilseniz offline modda kalın.

## 1. Hazırlık

1. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.
2. İstemcide `market_status` tool'uyla modun offline olduğunu doğrulayın.
3. `market://guide` ve `market://endpoints` resource'larını okuyun. Kullanıcının konumunu, yarıçapı ve bu
   konuma ait bilinen şubeleri belirleyin. Eksikleri not edin; henüz uzak sorgu yapmayın.

**Hazır sayılır:** Kontroller geçti, context biliniyor, live test ve sağlayıcı izinleri net.

## 2. Küçük live kabul testi

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

Her ürün çağrısına konumu, yarıçapı ve şubeleri açıkça ekleyin. Retry ayarı açıksa iki ürünlük bir sepet
bile bütçeyi aşabilir.

## 3. Gerekirse deneysel endpoint'ler

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

## 4. Sonucu kaydetme

1. HTTP 429 yanıtını ve bekleme süresini kullanıcıya gösterin.
2. Yalnızca denenen işlemi, endpoint'i, sürümü, tarihi ve gözlenen sonucu kaydedin. Kesin konumu, token'ları
   ve kişisel header'ları rapora eklemeyin.
3. Test bitince kullanıcının tercihine göre offline moda dönün.

**Geçme ölçütü:** Dönen fiyatlar, zincir ile şube ayrımı ve belirsizlikler gerçek istemcide doğru sunuldu.
Bu kabul, denenmemiş endpoint'ler veya daha büyük yükler için geçerli sayılmaz.
