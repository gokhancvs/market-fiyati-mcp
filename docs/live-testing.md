# Gerçek fiyatlarla sorgulama

**Başlayın:** İstemci ayarını aşağıdaki örnekle güncelleyin. Yaklaşık 5 dakika; erişim hazırsa.

Node.js 22+ ve stdio MCP istemcisi gerekir. Kaynak kod veya test kurulumu gerekmez.
Normal fiyat sorgusu için offline kabul testi veya ayrıca canlı test onayı gerekmez.
[Kullanım koşulları ve bağımsızlık açıklaması](../README.md#amaç-ve-kullanım-izinleri) operatöre yöneliktir.
Geliştirici kabul testleri bu rehberin sonundadır.

## 1. Konumu ve şube keşfini ayarlayın

Mevcut `market-fiyati` kaydını güncelleyin; ikinci kayıt eklemeyin.
**Örnek konum: Galata Kulesi (`41.025591, 28.974075`).**
Arama alanı merkezden **4 km yarıçap** (8 km çap). Başka konum için koordinatları değiştirin.
**Şube ID’leri bilinmiyorsa** aşağıdaki `MARKET_FIYATI_ENABLE_EXPERIMENTAL` değerini ilk kurulumda
`true` yapın. Yakın şube keşfi deneysel erişim gerektirir; varsayılan `false` değişmez.

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "npx",
      "args": ["-y", "market-fiyati-mcp@1.0.8"],
      "env": {
        "MARKET_FIYATI_MODE": "live",
        "MARKET_FIYATI_LATITUDE": "41.025591",
        "MARKET_FIYATI_LONGITUDE": "28.974075",
        "MARKET_FIYATI_DISTANCE": "4",
        "MARKET_FIYATI_ENABLE_EXPERIMENTAL": "false",
        "MARKET_FIYATI_RETRIES": "0"
      }
    }
  }
}
```

Env değerleri metin olarak aktarılır; sunucu koordinatları `double` sayıya çevirir.
Tool/API girdisinde sayılar tırnaksızdır; ondalık ayırıcı noktadır. Üç konum env alanını birlikte verin
veya üçünü kaldırın. **Env kullanmıyorsanız devam etmeden önce AI’a enlem, boylam ve km yarıçapını verin;**
bunları her konumlu çağrıya eklemesini isteyin. Otomatik 1 km yoktur.

Ayarı özel istemci dosyasında tutun. Sunucuyu yeniden başlatın; terminalde env değiştirmek yeterli değildir.
`npx` bulunamazsa mutlak yolunu kullanın. Paket henüz npm’de yoksa [kaynak sürümünü](../README.md#kaynak-koddan-geliştirme) çalıştırın.

## 2. Bağlantıyı kontrol edin

AI’a yazın:

> `market_status` çağır ve `market://guide` oku. Henüz veri sorgulama.

| Status alanı                        | Beklenen                   |
| ----------------------------------- | -------------------------- |
| `data.mode`                         | `live`                     |
| `data.liveRequestsEnabled`          | `true`                     |
| `data.locationDefaults.configured`  | Env kullanıyorsanız `true` |
| `data.experimentalEndpointsEnabled` | Bu örnekte `false`         |

Status koordinatları göstermez ve API’ye istek göndermez. Başarılı bağlantı, fiyat erişimini kanıtlamaz.

## 3. Şubeleri belirleyin

**Gerçek şube ID’leri varsa:** Bunları boş olmayan `depots` listesinde kullanın. Zincir adı yeterli değildir.

**Şubeler bilinmiyorsa:** Env’de `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` yapın, yeniden başlatın.
İlk kurulumda açtıysanız yeniden değiştirmeniz gerekmez. Status ile doğrulayıp AI’a yazın:

> Ayarlı veya verdiğim konum ve yarıçapla `market_find_nearby_depots` bir kez çağır. Dönen şubeleri göster;
> aramada bu ID’leri kullan. Sonuç boşsa dur.

Şubeleri elle daraltmak isteğe bağlıdır. `market_list_markets` gerekmez; ID uydurmayın.

## 4. Tek ürün arayın

AI’a yazın:

> Ayarlı veya verdiğim konum, yarıçap ve belirlediğimiz şubelerle `market_search_products` çağır.
> `keywords="süt"`, `pages=0`, `size=5`. Ürün, gramaj, şube, TRY fiyatı, sorgu zamanı ve uyarıları göster.
> Ek sayfa, detay veya otomatik tekrar çağrısı yapma. Eksik bilgiyi tahmin etme.

**Başarılı:** Gerçek fiyatlar ve ürün bilgileri hatasız gösterilir. Boş sonuç başarı veya “stok yok” değildir;
ilk sayfa tüm ürünleri kapsamaz.

Retry kapalıyken arama **1**, şube keşfiyle **2** HTTP denemesidir. Bu sayılar sağlayıcı kotası garantisi değildir.

### Hata varsa

| Durum                                | Yapılacak işlem                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `NETWORK_DISABLED`                   | İstemcideki açık `offline` ayarını `live` yapıp yeniden başlatın.                 |
| `EXPERIMENTAL_DISABLED`              | Şube keşfi için operatör deneysel erişimi açmalıdır.                              |
| `CONFIG_ERROR` / girdi hatası        | Üç konum alanını, sınırları ve ürün çağrısındaki `depots` listesini kontrol edin. |
| 429/403/5xx / `TIMEOUT`              | Tekrar çağırmayın; durumu ve bekleme bilgisini inceleyin.                         |
| Boş/eksik sonuç / `INVALID_RESPONSE` | Başarı veya stok sonucu çıkarmayın; güvenli hata özetini kaydedin.                |

<details>
<summary>Konumu değiştirmek veya adres kullanmak</summary>

- Başka konum için enlem/boylamı birlikte verin. Distance verilmezse env yarıçapı kullanılır.
- Çağrıdaki değerler yalnız o çağrıya aittir. Yeni konumda eski şubeleri doğrulayın veya yeniden keşfedin.
- Yalnız adres varsa deneysel `market_geocode_address` bir kez çağrılabilir. Belirsiz adayı kullanıcı seçer;
  yarıçapı da kullanıcı sağlar. Bu işlem bütçeye bir HTTP denemesi ekler.

[Tam konum sözleşmesi](api.md#context).

</details>

<details>
<summary>Geliştirici kabulü: daha fazla endpoint denemek</summary>

Bu bölüm paket kullanıcısının kurulum adımı değildir. Geliştirmede offline kalın; canlı kabulü
yalnız kullanıcıyla birlikte başlatın. Önce aşağıdaki offline kontrolleri tamamlayın, sonra bu
oturum için operatörün seçtiği live ayarıyla küçük sorguları yürütün.

1. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın; `market://guide` ve `market://endpoints` okuyun.
2. İzinli küçük live testte bilinen API filtreleriyle tür, gramaj ve sıralamayı birleştirin. Filtreler
   bilinmiyorsa kategori/facet keşfi yapın; sayfa kapsamını kontrol edin.
3. Ürün ID’si ve gramajı doğrulandıktan sonra gereken endpoint’leri ayrı sınayın: detay, benzer ürün,
   fiyat geçmişi; kategori/fiyat/gramaj/indirim filtreleri.
4. `limits.basketItems` izin veriyorsa iki ürünlük sepeti zincir ve şube bazında karşılaştırın.
   Eksik üründe `total=null` beklenir. Retry bütçeye dâhildir; iki ürün bile sınırı aşabilir.
5. Gereken deneysel endpoint’leri operatör açtıktan sonra sırayla sınayın: market listesi, geocode/ters
   geocode, yakın şubeler, sync ve alternatifler. Yanıtı [API sözleşmesiyle](api.md) karşılaştırın;
   farklı biçimi tahminle dönüştürmeyin, sözleşme düzeltmesine sentetik regresyon testi ekleyin.

Her ürün çağrısı `depots` alır; konum ve yarıçap env veya çağrıdan tamamlanır.
Normal kullanımda mevcut teklif yeterliyse ek detay sorgusu gerekmez.

**Live yük, uzun/büyük sepet, süre ve kota keşfi yapılmaz.** Listeyi bölmek veya sync’e geçmek bu sınırı kaldırmaz.
Timeout/Stop davranışını [sentetik kabul kitiyle](offline-acceptance.md) sınayın.
SDK başarısı masaüstü istemci kabulü değildir; küçük live örnek büyük yükü veya güvenli kotayı kanıtlamaz.
Yalnız denenen endpoint, istemci/paket sürümü, tarih ve güvenli sonuç özetini kaydedin;
koordinat, token ve ham yanıtları proje dışında tutun. 429 bekleme süresini kullanıcıya gösterin.
Kabul oturumundan sonra geliştirme ayarını yeniden `offline` yapıp sunucuyu yeniden başlatın.

</details>
