# Kullanıcıyla canlı test

Kullanıcının test onayı, sağlayıcının API/veri kullanım izni yerine geçmez.
Canlı aşamadan önce [kullanım koşulları ve gerekli izinler](../README.md#amaç-ve-kullanım-izinleri)
netleştirilmelidir. Belirsizlik sürüyorsa çevrimdışı testlerle devam edin.

Canlı API çağrısı, kullanıcı açıkça birlikte test aşamasını başlattıktan sonra yapılır.
Uzun/büyük sepet için canlı test yapılmaz:
API engelleme riski nedeniyle yük, süre veya sınır keşfi denemeleri yapılmamalı;
sepeti küçük çağrılara bölerek aynı yükü üretmek bu kısıtı aşmaz. Aşağıdaki küçük
kabul senaryoları da ayrıca canlı test izni gerektirir.

## Hazırlık

1. `MARKET_FIYATI_MODE=offline npm run check` ile tip kontrolü, derleme ve sentetik testleri çalıştırın.
2. İstemcide `market_status` ile offline modunu doğrulayın.
3. `market://guide` ve `market://endpoints` okuyun. Kullanıcının konumu ve yarıçapı
   için verilmiş şubeleri belirleyin; eksik bağlamı not edin. Elle mağaza seçimi
   isteğe bağlıdır. Offline hazırlıkta uzak sorgu yapılmaz.

## Canlı aşama

1. İstemci ortamını `MARKET_FIYATI_MODE=live` yapıp sunucuyu yeniden başlatın.
   Başlangıç istek göndermez; önce `market_status` kontrol edilir.
   Şubeler eksikse operatör ayrıca `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true`
   ayarladıktan sonra yakın şubeleri bir kez sorgulayın. Her ürün çağrısına
   gerekli konum, yarıçap ve şube bağlamını açıkça verin.
2. Bilinen kategori/filtre değerlerini kullanın; eksikse kategori/facet keşfi yapın.
   Tek bir aramada ürün türü, gramaj ve sıralama parametrelerini API'ye gönderin.
   Sonuç sayısını ve sayfalama kapsamını kontrol edin. Normal kullanımda arama
   teklifleri yeterliyse ek detay sorgusu gerekmeyebilir; aşağıdaki çağrılar ayrı
   uçların entegrasyon testleri içindir.
3. Bir ürün ID'sini ve gramajını doğrulayıp detay, benzerler, fiyat geçmişi alın.
4. Kategori ve fiyat/gramaj/indirim filtrelerini ayrı ayrı kontrol edin.
5. İki ürünle sepeti market ve depot düzeyinde karşılaştırın. Eksik ürünün toplamı
   null olmalı; farklı şubeler tek mağaza diye birleştirilmemelidir.

## Deneysel uçlar

Gerçek AI istemcisinde iki ürünlü küçük canlı kabul, dönen fiyatların ve
market/depot gruplarının sunumunu sınar. Önce market, sonra depot düzeyinde
kontrol edin. Önce `market_status` etkin ürün limitini okuyun; retry açılmışsa
iki ürün bile bütçeyi aşabilir. SDK sentetik testleri 5 ürün, bütçe reddi ve
timeout/iptal akışını kapsar; bu, kullanılan gerçek istemcinin aynı boyut/süreyi
desteklediğini kanıtlamaz.

İstemci timeout'u, durdurma düğmesi ve uzun bekleme kabulü ayrı bir çevrimdışı
çalışmadır: ağ engelleyici ve sahte fetch ile sentetik gecikme kullanılır.
Uzun sepet, canlı timeout veya yük denemesi yapılmaz. SDK test başarısı kullanılan
masaüstü istemcisinin kabulü olarak kaydedilmez. Geçmiş küçük canlı örneklerden
güvenli istek kotası çıkarmayın; desteklenen kapsam ve istek bütçesi ayrıca
belirlenmelidir. Sepeti sessizce bölmeyin ve kısmi sonucu tam sepet diye sunmayın.

Gerektiğinde `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` ile market listesi, geocode,
yakın şubeler, toplu ürün yenileme, alternatifler ve ters geocode işlemini sırayla test edin.
Her yanıtı `docs/api.md` sözleşmesiyle karşılaştırın. Gerçek biçim farklıysa şemayı
ve sentetik regresyon testini güncelleyin; doğru olduğu varsayımıyla dönüştürmeyin.

HTTP 429 ve bekleme bilgisini kullanıcıya gösterin. Hata raporlarına kesin konum,
kişisel header veya token eklemeyin. Test bitince modu kullanıcının tercihine göre
offline'a geri alın. Uzak doğrulama sonucunu yalnız gerçekten denenmiş işlemler
ve gözlenen sonuçlarla belgeleyin.
