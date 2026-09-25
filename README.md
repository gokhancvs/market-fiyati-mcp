# Market Fiyatı MCP

Market Fiyatı verileriyle ürün aramak, şube fiyatlarını karşılaştırmak, fiyat geçmişini incelemek
ve sepet karşılaştırması yapmak için bir stdio MCP sunucusu.

**15 tool · 3 resource · 3 prompt.** Node.js 22 veya üzeri gerekir.

Unofficial stdio MCP server for Turkish grocery prices. Requires Node.js 22+.
Offline by default: status and tool discovery work; remote price requests are blocked.
Read the [usage permissions](#amaç-ve-kullanım-izinleri) before live use.

**Gerçek fiyatlarla denemek için:** [Canlı test başlangıcını](#3-gerçek-fiyatlarla-canlı-test) izleyin.
Offline bağlantı kontrolüdür; gerçek ürün ve fiyat sorguları için `live` modu gerekir.

## 1. npm ile kurulum (yaklaşık 1 dakika)

Kaynak kodu klonlamadan, [örnek MCP yapılandırmasını](examples/mcp-config.json) istemcinizin
stdio sunucu ayarlarına uyarlayın:

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "npx",
      "args": ["-y", "market-fiyati-mcp@1.0.6"],
      "env": { "MARKET_FIYATI_MODE": "offline" }
    }
  }
}
```

`npx` paketi npm'den indirebilir. İstemci `npx` komutunu bulamazsa programın mutlak yolunu kullanın.
**Offline mod gerçek fiyat veya sahte fiyat demosu sağlamaz; Market Fiyatı API isteklerini engeller.**
Sunucu stdio üzerinden JSON-RPC konuşur; normal çalışma sırasında stdout yalnızca MCP trafiğidir.

## 2. Bağlantıyı doğrulama (yaklaşık 1 dakika)

MCP istemcinize şunu yazın:

> `market_status` tool'unu çağır ve sunucunun modunu göster.

**Beklenen sonuç:** Tool yanıt verir ve mod `offline` olarak görünür. Sunucunun başlaması, tool
listesinin alınması ve resource okunması ağ isteği oluşturmaz. Bu modda gerçek fiyat sorguları engellenir.

Sunucu HTTP portu açmaz; stdio üzerinden JSON-RPC kullanır.

## 3. Gerçek fiyatlarla canlı test

[Kullanım izinlerini](#amaç-ve-kullanım-izinleri) netleştirdikten sonra, yukarıdaki istemci ayarında
`MARKET_FIYATI_MODE` değerini `live` yapın ve MCP sunucusunu yeniden başlatın.

1. `market_status` çağırın: `mode=live` ve `liveRequestsEnabled=true` olmalı. Bu çağrı henüz API erişimini sınamaz.
2. Aşağıdaki env konumunu tanımlayın veya AI'a test konumunun enlem/boylamını ve yarıçapını bir kez verin.
   `market_status.data.locationDefaults.configured=true` ise AI env konumunu tekrar sormadan kullanabilir.
   Şubeler bilinmiyorsa `MARKET_FIYATI_ENABLE_EXPERIMENTAL=true` ayarıyla sunucuyu yeniden başlatıp
   `market_find_nearby_depots` ile bir kez keşif yapın; dönen şubeleri kullanın.
3. “Bu konum ve şubelerde `süt` için `market_search_products` ile tek arama yap; `pages=0`, `size=5`.
   Dönen ürünleri, gramajları, şube fiyatlarını ve uyarıları göster. Ek sayfa veya otomatik tekrar çağrısı yapma.” diye sorun.

**Beklenen sonuç:** Gerçek API'den ürün/şube teklifleri gelir; fiyatlar TRY olarak gösterilir.
Boş sonuç fiyat doğrulaması değildir. Hata alırsanız tekrar denemeden önce nedenini inceleyin.

[Kopyalanabilir canlı yapılandırma, şube keşfi ve hata çözümleri →](docs/live-testing.md)
Yalnızca npm paketini kullanmak için kaynak kodu klonlamanız veya `npm run check` çalıştırmanız gerekmez.

### Konumu bir kez env içinde ayarlama — 1.0.6

İstemcinizde mevcut `env` alanını aşağıdaki gibi düzenleyin. **0/0 yalnız örnektir:** kendi enlem/boylamınızla,
`2` değerini de istediğiniz km yarıçapıyla değiştirin. Noktalı ondalık kullanın; değerler JSON string'idir.

```json
{
  "MARKET_FIYATI_MODE": "offline",
  "MARKET_FIYATI_LATITUDE": "0",
  "MARKET_FIYATI_LONGITUDE": "0",
  "MARKET_FIYATI_DISTANCE": "2"
}
```

Üç env değeri **birlikte** verilir; eksik/geçersiz ayar sunucunun başlamasını durdurur. Env tanımlamak
istemiyorsanız üçünü de kaldırın ve her konumlu çağrıda enlem, boylam, yarıçap sağlayın. Otomatik 1 km
varsayımı yoktur. Çağrıda verilen tam koordinat çifti ve yarıçap env değerlerinin önüne geçer; tek
koordinat kabul edilmez. Bir çağrı sonraki çağrının ayarını değiştirmez. Değişen env için yeniden başlatın.

Şubeler konuma göre ayrıca keşfedilir; MCP şube listesini saklamaz. Aynı MCP sürecine bağlı çağrılar
aynı env konumunu kullanır; farklı kullanıcı konumları için ayrı sunucu süreçleri veya açık çağrı
değerleri kullanın. Gerçek koordinatları proje dosyalarına değil, özel istemci yapılandırmanıza yazın.
Bu özellik 1.0.5'te yoktur; 1.0.6 henüz npm'de yoksa bu kaynak sürümünü yerelden çalıştırın.

## 4. Ne yapmak istiyorsunuz?

| Amaç                            | Tool veya rehber                |
| ------------------------------- | ------------------------------- |
| Ürün aramak                     | `market_search_products`        |
| Şube fiyatlarını karşılaştırmak | `market_compare_product_offers` |
| Sepet karşılaştırmak            | `market_compare_basket`         |
| Fiyat geçmişini incelemek       | `market_get_price_history`      |
| Çağrı akışını öğrenmek          | `market://guide`                |

Konum ve yarıçap çağrıdan veya yapılandırılmış env değerlerinden alınır; şubeler her ürün çağrısında
açıkça verilir. MCP kullanıcı override'larını hatırlamaz, sonuç cache'i tutmaz ve aramayı gizlice
genişletmez. Live erişimi açıp açmamak operatörün kararıdır.

İlk ürün aramasında konum, yarıçap ve boş olmayan `depots` listesi gerekir. Konuma uygun bilinen
şube kimliklerini kullanın. Şubeler bilinmiyorsa `market_find_nearby_depots` deneysel erişim gerektirir;
operatör izin verdiğinde bir kez keşif yapıp dönen şubelerle arayın. `NETWORK_DISABLED` offline ağ
kilidini, `EXPERIMENTAL_DISABLED` deneysel erişim kilidini belirtir. AI bu ayarları kendiliğinden açmamalıdır.
İzinli geçiş için [live test rehberini](docs/live-testing.md) izleyin.

## Kaynak koddan geliştirme

Depoyu klonladıktan sonra:

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

Yerel kaynakla bağlanmak için istemcide program olarak `node`, argüman olarak
`dist/src/index.js` dosyasının mutlak yolunu ve `MARKET_FIYATI_MODE=offline` kullanın.
Gerekirse `node` yolunu da mutlak yazın. `npm start` terminalde stdio mesajlarını bekler.
`npm ci` npm'e bağlanabilir; uygulama testleri Market Fiyatı API'sine bağlanmaz.
Ortamınızda RTK kuralı varsa geliştirme komutlarının başına `rtk` ekleyin.

## Sonuçları doğru okumak

- **Fiyatlar TRY cinsindendir.** `percentage` alanı indirim oranı değildir. İndirim için API'nin
  `discount` işaretine bakılır.
- **Eksik offer "bilinmiyor" demektir.** Buradan stok olmadığı ya da tüm fiyatların tarandığı sonucu çıkarılmaz.
- **Sepet eksikse** `total` değeri `null` olur. `subtotal` yalnızca bulunan ürünlerin toplamıdır.
- **Bir market zincirinin birden fazla şubesi olabilir.** Fiziksel şubeleri ayrı ayrı karşılaştırmak için
  `groupBy=depot` kullanın.
- **Sepet için istek bütçesi, retry'lar dâhil 5 HTTP denemesidir.** Bu sınır, listeyi bölerek veya başka bir
  tool kullanarak aşılmamalıdır.

Satın alma, sipariş ve barkodla sorgulama desteklenmez. Uzak API değişirse endpoint sözleşmesinin
güncellenmesi gerekebilir.

## Diğer belgeler

| İhtiyaç                                    | Belge                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Tool'lar, filtreler, yanıtlar ve sınırlar  | [API sözleşmesi](docs/api.md)                                                    |
| Ayarlar, kod yapısı ve geliştirme          | [Mimari](docs/architecture.md)                                                   |
| Testleri çalıştırma ve neyi kanıtladıkları | [Doğrulama](docs/verification.md) · [Sentetik kabul](docs/offline-acceptance.md) |
| İzin alınmış live test                     | [Live test rehberi](docs/live-testing.md)                                        |
| Sürüm hazırlama ve değişiklik geçmişi      | [Yayın rehberi](docs/releasing.md) · [CHANGELOG](CHANGELOG.md)                   |

## Amaç ve kullanım izinleri

Bu proje, ticari kazanç veya başka bir çıkar gözetilmeden geliştirilmiş bağımsız bir çalışmadır.
Market Fiyatı'nın, TÜBİTAK'ın veya market zincirlerinin resmî ürünü değildir. Herhangi bir onay,
sponsorluk veya ortaklık iddiası yoktur.

Live kullanıma geçmeden önce [Market Fiyatı kullanım koşullarını](https://marketfiyati.org.tr/kullanim-kosullari)
okuyun ve gerekli yazılı izinleri sağlayıcıyla netleştirin. O zamana kadar `offline` modunu kullanın.
Ticari amaç gütmemek, veri saklamamak ya da endpoint'e teknik olarak erişebilmek kullanım izni anlamına
gelmez. Bu depo, üçüncü taraf API'lere erişim izni vermez.

Güvenlik açığı bildirmek için [özel bildirim yönergesini](SECURITY.md) kullanın.

## Lisans

[MIT](LICENSE) — Copyright (c) 2026 Gökhan Çavuş.

Lisans yalnızca yazılımı ve beraberindeki belgeleri kapsar. Üçüncü tarafların verilerine, markalarına,
logolarına veya servislerine erişim hakkı vermez. Yukarıdaki amaç beyanı MIT lisansını değiştirmez ve
koda ticari kullanım yasağı eklemez. Üçüncü taraf bileşenler kendi lisanslarına tabidir.
