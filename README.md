# Market Fiyatı MCP

**Başlayın:** Aşağıdaki yapılandırmayı MCP istemcinize ekleyin. Yaklaşık 2 dakika.

Türkiye’de ürün, şube fiyatı ve sepet karşılaştırması için resmî olmayan MCP sunucusu.
**Node.js 22+ gerekir.** Aşağıdaki kurulum gerçek fiyat sorguları için `live` modunu kullanır.
Başlamadan [kullanım izinlerini](#amaç-ve-kullanım-izinleri) kontrol edin.

## 1. İstemciye ekleyin

```json
{
  "mcpServers": {
    "market-fiyati": {
      "command": "npx",
      "args": ["-y", "market-fiyati-mcp@1.0.6"],
      "env": {
        "MARKET_FIYATI_MODE": "live",
        "MARKET_FIYATI_LATITUDE": "41.025591",
        "MARKET_FIYATI_LONGITUDE": "28.974075",
        "MARKET_FIYATI_DISTANCE": "4"
      }
    }
  }
}
```

**Örnek: Galata Kulesi — `41.025591, 28.974075`.**
`distance=4`, merkezden **4 km yarıçap** demektir (8 km çap).

**Sayı tipi:** Tool/API girdisi `number`’dır; sunucuda 64 bit kayan noktalı sayı (`double`) kullanılır.
Yalnız `env` değerleri ortam değişkeni olduğu için tırnaklıdır; sunucu bunları sayıya çevirir.

`market_find_nearby_depots` için aynı örnek, tırnaksız sayılarla:

```json
{ "latitude": 41.025591, "longitude": 28.974075, "distance": 4 }
```

Kendi konumunuz için koordinatları değiştirin. Kişisel konumunuzu özel istemci ayarında tutun; Git’e eklemeyin.

Env konumu 1.0.6 ile geldi. Paket kurulamıyorsa [kaynak koddan çalıştırın](#kaynak-koddan-geliştirme).
`npx` paketi indirir; bulunamazsa mutlak yolunu kullanın. [Hazır Galata yapılandırması](examples/mcp-config.json).

## 2. Bağlantıyı doğrulayın

Sunucuyu yeniden başlatıp AI’a şunu yazın:

> `market_status` çağır. Modu ve konum ayarının hazır olup olmadığını göster.

**Beklenen:** `data.mode=live`, `data.liveRequestsEnabled=true`, `data.locationDefaults.configured=true`.
Status yalnız ayarları kontrol eder; gerçek fiyat için sonraki adımdaki aramayı yapın.

## 3. Gerçek fiyatlarla canlı test

[Canlı test rehberini açın](docs/live-testing.md). Yaklaşık 5 dakika; istemci ve sağlayıcı erişimi hazırsa.

Rehber: **izinleri kontrol et → live ayarla → şubeleri bul → tek ürün ara.**
AI live veya deneysel erişimi kendiliğinden açmaz.

## Konum nasıl çalışır?

| Durum                     | Kural                                                                       |
| ------------------------- | --------------------------------------------------------------------------- |
| Env kullanıyorum          | Üç değeri birlikte ayarlayın; AI her sorguda tekrar sormaz.                 |
| Env kullanmıyorum         | Üçünü de kaldırın; enlem, boylam ve yarıçapı her konumlu çağrıda sağlayın.  |
| Başka konum arıyorum      | Enlem/boylamı birlikte verin. Distance yoksa env yarıçapı kullanılır.       |
| Eksik veya geçersiz değer | Env hatası başlangıcı, çağrı hatası sorguyu durdurur. Otomatik 1 km yoktur. |
| Ayarı değiştirdim         | Env için yeniden başlatın. Çağrıdaki değişiklik yalnız o çağrıya aittir.    |

Şubeler (`depots`) ürün çağrısında ayrıca gerekir; MCP bunları saklamaz.
Aynı süreç env konumunu paylaşır; farklı kullanıcılar ayrı süreç veya açık çağrı değerleri kullanmalıdır.
[Tüm konum kuralları ve sınırlar](docs/api.md#context).

## Yapabilecekleriniz

| Amaç                         | Tool                            |
| ---------------------------- | ------------------------------- |
| Ürün ara                     | `market_search_products`        |
| Şube fiyatlarını karşılaştır | `market_compare_product_offers` |
| Sepet karşılaştır            | `market_compare_basket`         |
| Fiyat geçmişini incele       | `market_get_price_history`      |
| Çağrı akışını öğren          | `market://guide`                |

**15 tool · 3 resource · 3 prompt.** Satın alma, sipariş ve barkod sorgusu desteklenmez.

## Sonuçları doğru okuyun

- Fiyatlar **TRY**. `percentage` indirim oranı değildir; API’nin `discount` işaretine bakın.
- Eksik teklif **bilinmiyor** demektir; “stok yok” veya “tüm fiyatlar tarandı” denemez.
- Eksik sepette `total=null`; `subtotal` yalnız bulunan ürünlerdir.
- Fiziksel şube karşılaştırması için `groupBy=depot` kullanın; zincir tek mağaza değildir.
- Sepet bütçesi retry dâhil **5 HTTP denemesi**. Listeyi bölerek veya tool değiştirerek aşmayın.

## Kaynak koddan geliştirme

Depoyu klonlayıp çalıştırın:

```sh
npm ci --ignore-scripts
npm run check
```

`check` derlemeyi de yapar. İstemcide `command: "node"`, `args` içinde `dist/src/index.js` dosyasının
mutlak yolunu kullanın. Gerçek fiyat sorguları için yukarıdaki `live` env ayarını ekleyin;
geliştirme testleri ağ engelli kalır. Gerekirse `node` yolunu da mutlak yazın.
RTK kullanıyorsanız komutları onunla çalıştırın.

Sunucu stdio JSON-RPC kullanır; HTTP portu açmaz. `npm start` MCP mesajlarını bekler.
stdout yalnız MCP trafiğidir. npm kurulumu ağ kullanabilir; uygulama testleri API’ye bağlanmaz.

## Ayrıntı gerektiğinde

| İhtiyaç                         | Belge                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Gerçek fiyatlarla test          | [Canlı test](docs/live-testing.md)                                               |
| Tool, filtre ve yanıt kuralları | [API](docs/api.md)                                                               |
| Ayarlar ve kod yapısı           | [Mimari](docs/architecture.md)                                                   |
| Testler ve sınırları            | [Doğrulama](docs/verification.md) · [Sentetik kabul](docs/offline-acceptance.md) |
| Sürüm çıkarma                   | [Yayın rehberi](docs/releasing.md) · [CHANGELOG](CHANGELOG.md)                   |

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
