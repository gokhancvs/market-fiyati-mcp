# Market Fiyatı MCP

**Başlayın:** Node.js 22+ ile aşağıdaki kaynak kurulumunu tamamlayın.

Ürün arama, şube fiyatı, fiyat geçmişi ve sepet karşılaştırması için stdio MCP sunucusu.
**15 araç · 3 kaynak · 3 istem şablonu.**

## 1. Kurun · yaklaşık 2–5 dakika

Proje klasöründe:

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

Süre bağlantıya ve bilgisayara göre değişir. `npm ci` paket kaynağına erişebilir;
Market Fiyatı API'sine istek göndermez. Yerel RTK kuralı varsa komutların başına `rtk` ekleyin.

[Örnek MCP yapılandırmasını](examples/mcp-config.json) kullanın:
`command` için `node`, argüman için `dist/src/index.js` dosyasının **mutlak yolunu** yazın.
GUI Node'u bulamazsa onun da mutlak yolunu kullanın. Doğrudan `node`, stdout'u MCP trafiğine ayırır.

**Başarı işareti:** Kurulum, derleme ve kontroller hatasız tamamlanır.

<details>
<summary>npm ile bağlantı</summary>

Yayımlanmış [npm paketini](https://www.npmjs.com/package/market-fiyati-mcp) Node.js 22+ ile bağlayın:

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "npx",
      "args": ["-y", "market-fiyati-mcp@1.0.1"],
      "env": { "MARKET_FIYATI_MODE": "offline" }
    }
  }
}
```

`npx` npm'den paket indirebilir. **Offline mod Market Fiyatı API isteklerini engeller.**
GUI `npx` bulamazsa programın mutlak yolunu kullanın.

</details>

## 2. Bağlantıyı doğrulayın · yaklaşık 1 dakika

İstemciye sorun:

> `market_status` aracını çağır ve sunucunun modunu göster.

**Beklenen:** Araç yanıt verir; mod `offline` görünür. Başlangıç, araç keşfi ve kaynak okuma ağ isteği oluşturmaz.
Gerçek fiyat sorguları bu modda engellenir.

`npm start` terminalde mesaj bekler: HTTP portu açmaz, stdio JSON-RPC kullanır.

## 3. Yapacağınız işi seçin

| Amaç                            | Araç / rehber                   |
| ------------------------------- | ------------------------------- |
| Ürün aramak                     | `market_search_products`        |
| Şube fiyatlarını karşılaştırmak | `market_compare_product_offers` |
| Sepet karşılaştırmak            | `market_compare_basket`         |
| Geçmiş fiyatları incelemek      | `market_get_price_history`      |
| Çağrı akışını öğrenmek          | `market://guide`                |

Her ürün çağrısında konum, yarıçap ve şubeler açıkça verilir. MCP bunları hatırlamaz;
sonuç önbelleği ve gizli arama genişletmesi yoktur. Canlı erişim operatör ayarıdır.

## Sonuçları doğru okuyun

- **Fiyat TRY'dir.** `percentage` indirim oranı değildir; API'nin `discount` işareti esas alınır.
- **Eksik teklif = bilinmiyor.** Stok yokluğu veya tüm fiyatların tarandığı sonucu çıkarılmaz.
- **Eksik sepet:** `total=null`; `subtotal` yalnız bulunan kalemlerdir.
- **Zincir birden fazla şube içerebilir.** Fiziksel şube karşılaştırması için `groupBy=depot` kullanın.
- **Sepet bütçesi retry dâhil 5 HTTP denemesidir.** Listeyi bölerek veya araç değiştirerek aşılmaz.

Satın alma/sipariş ve barkod sorgusu desteklenmez. Uzak API değişirse sözleşme güncellemesi gerekebilir.

## İhtiyacınız olan belgeyi açın

| İhtiyaç                                  | Belge                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Araçlar, filtreler, yanıtlar ve sınırlar | [API sözleşmesi](docs/api.md)                                                    |
| Ayarlar, kod yapısı ve geliştirme        | [Mimari](docs/architecture.md)                                                   |
| Test çalıştırma ve kanıt sınırları       | [Doğrulama](docs/verification.md) · [Sentetik kabul](docs/offline-acceptance.md) |
| İzinli canlı test                        | [Canlı test rehberi](docs/live-testing.md)                                       |
| Sürüm hazırlama ve değişiklikler         | [Yayın rehberi](docs/releasing.md) · [CHANGELOG](CHANGELOG.md)                   |

## Amaç ve kullanım izinleri

Bu proje ticari kazanç veya çıkar gözetilmeden geliştirilmiş bağımsız bir çalışmadır.
Market Fiyatı, TÜBİTAK veya market zincirlerinin resmî ürünü değildir;
onay, sponsorluk veya ortaklık iddia edilmez.

Canlı kullanımdan önce [Market Fiyatı kullanım koşullarını](https://marketfiyati.org.tr/kullanim-kosullari)
ve gerekli yazılı izinleri sağlayıcıyla netleştirin. O zamana kadar `offline` kullanın.
Ticari amaç taşımamak, veri saklamamak veya endpoint'e erişebilmek kullanım izni değildir.
Bu depo üçüncü taraf API erişim izni sağlamaz.

## Lisans

[MIT](LICENSE) — Copyright (c) 2026 Gökhan Çavuş.

Lisans yazılım ve beraberindeki belgeler içindir; üçüncü taraf verileri, markaları,
logoları veya servislerine erişim hakkı vermez. Geliştirme amacı beyanı MIT'yi değiştirmez
ve koda ticari kullanım yasağı eklemez. Üçüncü taraf bileşenlerin kendi lisansları geçerlidir.
