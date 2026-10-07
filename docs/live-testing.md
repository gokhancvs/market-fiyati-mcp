# Gerçek fiyatlarla sorgulama

**Başlayın:** İstemci ayarını aşağıdaki örnekle güncelleyin.

Node.js 22+ ve stdio MCP istemcisi gerekir. Kaynak kod veya test kurulumu gerekmez.
[Kullanım koşulları ve bağımsızlık açıklaması](../README.md#amaç-ve-kullanım-izinleri) operatöre yöneliktir.
Geliştirici kabul testleri bu rehberin sonundadır.

## 1. Konumu ve şube keşfini ayarlayın

Mevcut `market-fiyati` kaydını güncelleyin; ikinci kayıt eklemeyin.
**Örnek konum: Galata Kulesi (`41.025591, 28.974075`).**
Arama alanı merkezden **4 km yarıçap** (8 km çap). Başka konum için koordinatları değiştirin.
Yakın şube keşfi deneysel erişim gerektirdiği için örnekte `MARKET_FIYATI_ENABLE_EXPERIMENTAL` değeri `true`'dur.
Bu ayar yakın şube, market listesi, adres/koordinat arama, toplu ürün güncelleme ve alternatif ürün tool'larını açar. Varsayılan `false`
değişmez; şube ID'lerini zaten biliyorsanız değeri `false` yapabilirsiniz.

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "npx",
      "args": ["-y", "market-fiyati-mcp@2.0.1"],
      "env": {
        "MARKET_FIYATI_MODE": "live",
        "MARKET_FIYATI_LATITUDE": "41.025591",
        "MARKET_FIYATI_LONGITUDE": "28.974075",
        "MARKET_FIYATI_DISTANCE": "4",
        "MARKET_FIYATI_ENABLE_EXPERIMENTAL": "true",
        "MARKET_FIYATI_RETRIES": "0"
      }
    }
  }
}
```

Env değerleri metin olarak aktarılır; sunucu bunları sayıya çevirir.
Tool/API girdisinde sayılar tırnaksızdır; ondalık ayırıcı noktadır. Üç konum env alanını birlikte verin
veya üçünü kaldırın. **Env kullanmıyorsanız devam etmeden önce AI'ya enlem, boylam ve km yarıçapını verin;**
bunları her konumlu çağrıya eklemesini isteyin. Otomatik 1 km yoktur.

Ayarı özel istemci dosyasında tutun. Sunucuyu yeniden başlatın; terminalde env değiştirmek yeterli değildir.
`npx` bulunamazsa mutlak yolunu kullanın. Paket kurulamıyorsa [kaynak koddan çalıştırın](../README.md#kaynak-koddan-geliştirme).

## 2. Bağlantıyı kontrol edin

AI'ya yazın:

> `market_status` çağır ve `market://guide` oku. Henüz veri sorgulama.

| Status alanı                        | Beklenen                   |
| ----------------------------------- | -------------------------- |
| `data.mode`                         | `live`                     |
| `data.liveRequestsEnabled`          | `true`                     |
| `data.locationDefaults.configured`  | Env kullanıyorsanız `true` |
| `data.experimentalEndpointsEnabled` | Bu örnekte `true`          |

Status koordinatları göstermez ve API'ye istek göndermez. Başarılı bağlantı, fiyat erişimini kanıtlamaz.

## 3. Şubeleri belirleyin

**Gerçek şube ID'leri varsa:** Bunları boş olmayan `depots` listesinde kullanın. Zincir adı yeterli değildir.

**Şubeler bilinmiyorsa:** Env'de `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` yapın, yeniden başlatın.
İlk kurulumda açtıysanız yeniden değiştirmeniz gerekmez. Status ile doğrulayıp AI'ya yazın:

> Ayarlı veya verdiğim konum ve yarıçapla `market_find_nearby_depots` bir kez çağır. Dönen şubeleri göster;
> aramada bu ID'leri kullan. Sonuç boşsa dur.

Şubeleri elle daraltmak isteğe bağlıdır. `market_list_markets` gerekmez; ID uydurmayın.

## 4. Tek ürün arayın

AI'ya yazın:

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
| `EXPERIMENTAL_DISABLED`              | `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` ekleyip sunucuyu yeniden başlatın.       |
| `CONFIG_ERROR` / girdi hatası        | Üç konum alanını, sınırları ve ürün çağrısındaki `depots` listesini kontrol edin. |
| 429/403/5xx / `TIMEOUT`              | Tekrar çağırmayın; durumu ve bekleme bilgisini inceleyin.                         |
| Boş/eksik sonuç / `INVALID_RESPONSE` | Başarı veya stok sonucu çıkarmayın; güvenli hata özetini kaydedin.                |

<details>
<summary>Konumu değiştirmek veya adres kullanmak</summary>

- Başka konum için enlem/boylamı birlikte verin. Distance verilmezse env yarıçapı kullanılır.
- Çağrıdaki değerler yalnız o çağrıya aittir. Yeni konumda eski şubeleri doğrulayın veya yeniden keşfedin.
- Yalnız adres varsa deneysel `market_geocode_address` bir kez çağrılabilir. Belirsiz adayı kullanıcı seçer;
  yarıçapı da kullanıcı sağlar. Bu işlem bütçeye bir HTTP denemesi ekler.

[Tam konum sözleşmesi](api.md#konum-ve-şube-bağlamı).

</details>

<details>
<summary>Geliştirici kabulü: daha fazla endpoint denemek</summary>

Bu bölüm paket kullanıcısının kurulum adımı değildir. Geliştirme sırasında `offline` modda kalın;
live kabul testini operatör başlatır. Önce aşağıdaki offline kontrolleri tamamlayın, sonra operatörün
seçtiği live ayarıyla küçük sorgular yapın.

1. `MARKET_FIYATI_MODE=offline npm run check` çalıştırın; `market://guide` ve `market://endpoints` okuyun.
2. İzinli küçük live testte bilinen API filtreleriyle tür, gramaj ve sıralamayı birleştirin. Filtreler
   bilinmiyorsa kategori/facet keşfi yapın; sayfa kapsamını kontrol edin.
3. Ürün ID'si ve gramajı doğrulandıktan sonra gereken endpoint'leri ayrı sınayın: detay, benzer ürün,
   fiyat geçmişi; kategori/fiyat/gramaj/indirim filtreleri.
4. `limits.basketItems` izin veriyorsa iki ürünlük sepeti zincir ve şube bazında karşılaştırın.
   Eksik üründe `total=null` beklenir. Retry bütçeye dâhildir; iki ürün bile sınırı aşabilir.
5. Gereken deneysel endpoint'leri operatör açtıktan sonra sırayla sınayın: market listesi, geocode/ters
   geocode, yakın şubeler, sync ve alternatifler. Yanıtı [API sözleşmesiyle](api.md) karşılaştırın;
   farklı biçimi tahminle dönüştürmeyin, sözleşme düzeltmesine sentetik regresyon testi ekleyin.

Her ürün çağrısı `depots` alır; konum ve yarıçap env veya çağrıdan tamamlanır.
Normal kullanımda mevcut offer yeterliyse ek detay sorgusu gerekmez.

**Live yük, uzun/büyük sepet, süre ve kota keşfi yapılmaz.** Listeyi bölmek veya sync'e geçmek bu sınırı kaldırmaz.
Timeout/Stop davranışını [sentetik kabul testleriyle](https://github.com/gokhancvs/market-fiyati-mcp/blob/main/docs/offline-acceptance.md)
sınayın. Testlerin kanıtlamadıkları: [Doğrulama](verification.md#neyi-kanıtlamıyoruz).
Yalnız denenen endpoint, istemci/paket sürümü, tarih ve güvenli sonuç özetini kaydedin;
koordinat, token ve ham yanıtları proje dışında tutun. 429 bekleme süresini kullanıcıya gösterin.
Kabul oturumundan sonra geliştirme ayarını yeniden `offline` yapıp sunucuyu yeniden başlatın.

</details>
