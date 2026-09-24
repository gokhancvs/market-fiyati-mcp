# Kullanıcıyla canlı test

**Önce offline kontrolleri çalıştırın.** Canlı çağrı ancak kullanıcı birlikte test
etmeyi açıkça başlattığında ve [sağlayıcı izinleri](../README.md#amaç-ve-kullanım-izinleri)
netleştiğinde yapılır. Kullanıcı onayı, API/veri kullanım izni değildir; belirsizlikte offline kalın.

## 1. Hazırlayın

1. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın.
2. İstemcide `market_status` ile offline modunu doğrulayın.
3. `market://guide` ve `market://endpoints` okuyun; kullanıcı konumunu, yarıçapı ve
   bunlara ait mevcut şubeleri belirleyin. Eksikleri not edin; henüz uzak sorgu yapmayın.

**Hazır sayılır:** Kontroller geçti, bağlam biliniyor, canlı test ve sağlayıcı izinleri net.

## 2. Küçük canlı kabulü çalıştırın

Yalnız izinli aşamada:

1. Operatör ortamını `MARKET_FIYATI_MODE=live` yapıp sunucuyu yeniden başlatın.
   Önce `market_status` okuyun; başlangıç istek göndermez. Şubeler eksikse operatör
   deneysel erişimi açtıktan sonra yakın şubeleri bir kez sorgulayın. Elle seçim isteğe bağlıdır.
2. Ürün türü, gramaj ve sıralamayı bilinen API filtreleriyle tek aramada birleştirin.
   Değerler eksikse kategori/facet keşfi yapın; sonuç sayısı ve sayfa kapsamını kontrol edin.
3. Bir ürünün ID/gramajını doğrulayın; ayrı endpoint testleri için detay, benzer ve geçmiş fiyat alın.
   Normal kullanımda arama teklifleri yeterliyse detay çağrısı gerekmeyebilir.
4. Kategori, fiyat, gramaj ve indirim filtrelerini ayrı kontrol edin.
5. Etkin `limits.basketItems` iki ürüne izin veriyorsa küçük sepeti önce market, sonra depot bazında karşılaştırın.
   **Beklenen:** Eksik kalemde `total=null`; farklı şubeler tek mağaza gibi sunulmaz.

Her ürün çağrısına konum, yarıçap ve şubeleri açıkça ekleyin. Retry ayarı iki ürünün bile bütçeyi aşmasına yol açabilir.

## 3. Gerekliyse deneysel uçları sınayın

Operatör `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` ayarlar. Gereken uçları sırayla deneyin:
market listesi, geocode/ters geocode, yakın şubeler, toplu yenileme ve alternatifler.

Yanıtı [API sözleşmesiyle](api.md) karşılaştırın. Farklı biçimi tahminle dönüştürmeyin;
şemayı ve sentetik regresyon testini güncelleyin.

## Sınırı koruyun

- **Uzun/büyük sepet, yük, süre ve kota keşfi canlı yapılmaz.** Listeyi küçük çağrılara bölmek veya sync'e geçmek yasağı aşmaz.
- Timeout, Stop ve uzun bekleme kabulü [sentetik kabul kitiyle](offline-acceptance.md) yapılır; gerçek ağ engellenir.
- SDK'nin 5 ürün/bütçe/iptal testleri gerçek masaüstü istemcisinin kabulü değildir.
- Küçük canlı örneklerden güvenli kota çıkarmayın; kapsam/bütçeyi ayrıca belirleyin. Kısmi sepeti tam göstermeyin.

## 4. Sonucu kaydedin

1. HTTP 429 ve bekleme bilgisini kullanıcıya gösterin.
2. Yalnız denenen işlem, endpoint/sürüm/tarih ve gözlenen sonucu kaydedin.
   Kesin konum, token ve kişisel header'ları rapora koymayın.
3. Test bitince kullanıcının tercihine göre offline'a dönün.

**Geçme ölçütü:** Dönen fiyatlar, market/depot ayrımı ve belirsizlikler gerçek istemcide doğru sunuldu.
Bu kabul, denenmeyen uçlara veya daha büyük yüke genellenmez.
