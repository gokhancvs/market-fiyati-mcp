# Market Fiyatı MCP

Market Fiyatı verileriyle ürün aramak, şube fiyatlarını karşılaştırmak, fiyat geçmişini incelemek
ve sepet karşılaştırması yapmak için bir stdio MCP sunucusu.

**15 tool · 3 resource · 3 prompt.** Node.js 22 veya üzeri gerekir.

## 1. Kurulum (yaklaşık 2–5 dakika)

Proje klasöründe şu komutları çalıştırın:

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

Süre, internet bağlantınıza ve bilgisayarınıza göre değişir. `npm ci` paketleri indirmek için npm'e
bağlanabilir, ancak Market Fiyatı API'sine istek göndermez. Ortamınızda RTK kuralı varsa komutların
başına `rtk` ekleyin.

Ardından [örnek MCP yapılandırmasını](examples/mcp-config.json) kendi istemcinize uyarlayın:
`command` alanına `node`, argüman olarak da `dist/src/index.js` dosyasının **mutlak yolunu** yazın.
MCP istemciniz (örneğin bir masaüstü uygulaması) `node` komutunu bulamazsa onun için de mutlak yol kullanın. Sunucuyu doğrudan
`node` ile başlatmak, stdout'un yalnızca MCP trafiği için kullanılmasını sağlar.

**Başarılı sayılır:** Kurulum, derleme ve kontroller hatasız tamamlanır.

<details>
<summary>npm paketiyle bağlanma</summary>

Yayımlanmış [npm paketini](https://www.npmjs.com/package/market-fiyati-mcp) Node.js 22+ ile şu
şekilde bağlayabilirsiniz:

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "npx",
      "args": ["-y", "market-fiyati-mcp@1.0.4"],
      "env": { "MARKET_FIYATI_MODE": "offline" }
    }
  }
}
```

`npx` paketi npm'den indirebilir. **Offline mod, Market Fiyatı API'sine giden tüm istekleri engeller.**
MCP istemciniz `npx` komutunu bulamazsa programın mutlak yolunu kullanın.

</details>

## 2. Bağlantıyı doğrulama (yaklaşık 1 dakika)

MCP istemcinize şunu yazın:

> `market_status` tool'unu çağır ve sunucunun modunu göster.

**Beklenen sonuç:** Tool yanıt verir ve mod `offline` olarak görünür. Sunucunun başlaması, tool
listesinin alınması ve resource okunması ağ isteği oluşturmaz. Bu modda gerçek fiyat sorguları engellenir.

`npm start` komutu terminalde gelen mesajları bekler. HTTP portu açmaz; stdio üzerinden JSON-RPC kullanır.

## 3. Ne yapmak istiyorsunuz?

| Amaç                            | Tool veya rehber                |
| ------------------------------- | ------------------------------- |
| Ürün aramak                     | `market_search_products`        |
| Şube fiyatlarını karşılaştırmak | `market_compare_product_offers` |
| Sepet karşılaştırmak            | `market_compare_basket`         |
| Fiyat geçmişini incelemek       | `market_get_price_history`      |
| Çağrı akışını öğrenmek          | `market://guide`                |

Konum, yarıçap ve şubeler her ürün çağrısında açıkça verilir. MCP bu context'i hatırlamaz; sonuç cache'i
tutmaz ve aramayı gizlice genişletmez. Live erişimi açıp açmamak operatörün kararıdır.

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

## Lisans

[MIT](LICENSE) — Copyright (c) 2026 Gökhan Çavuş.

Lisans yalnızca yazılımı ve beraberindeki belgeleri kapsar. Üçüncü tarafların verilerine, markalarına,
logolarına veya servislerine erişim hakkı vermez. Yukarıdaki amaç beyanı MIT lisansını değiştirmez ve
koda ticari kullanım yasağı eklemez. Üçüncü taraf bileşenler kendi lisanslarına tabidir.
