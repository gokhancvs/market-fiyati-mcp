# Doğrulama

**Kaynak depoda çalıştırın:**

```sh
MARKET_FIYATI_MODE=offline npm run check
```

Yaklaşık 1–2 dakika. **Başarılı:** Biçim, lint, tip kontrolü, derleme ve testler geçer.
`tests/no-network.mjs` gerçek ağı engeller; testler sentetik veri ve fake fetch kullanır.

## Hangi kontrol gerekli?

| Amaç                            | Komut / rehber                                        |
| ------------------------------- | ----------------------------------------------------- |
| Kod değişikliğini doğrula       | Yukarıdaki `npm run check`                            |
| Bağımsız npm kurulumunu doğrula | `npm run test:consumer`                               |
| İstemcide timeout/Stop dene     | [Sentetik kabul](offline-acceptance.md)               |
| Gerçek fiyatlarla dene          | Kullanıcı başlattığında [canlı test](live-testing.md) |

Tüketici testi ayrı cache ve geçici dizinde yalnız üretim bağımlılıklarını kurar; gerçek npm
binary’sini sınar. Kurulum npm’e bağlanabilir, MCP süreci offline kalır.

## Neyi doğruluyoruz?

| Alan             | Kapsam                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Konum            | Env üçlüsü, sınırlar, zorunlu radius, çağrı önceliği, kısmi çiftin HTTP öncesi reddi; SDK payload’ları ve ayrı sunucu ayarları. |
| Sözleşme / fiyat | Girdi/yanıt şemaları, kesin ID’ler, TRY/kuruş hesabı, eksik sepet, şube kapsamı, null ve upstream ek alanları.                  |
| Ağ / kaynak      | Offline/deneysel kilitler, retry, timeout, iptal, FIFO, toplam bütçeler ve güvenli hatalar.                                     |
| Paket / yayın    | Paket dosyaları, sürüm, CLI/MCP açılışı; sahte registry ile tag, OIDC sırası, integrity ve latest kuralları.                    |
| Gizlilik / çıktı | Env koordinatlarının status/keşifte görünmemesi; outputSchema, text/structuredContent eşitliği ve sınırlı hata ayrıntıları.     |

## Neyi kanıtlamıyoruz?

- Sentetik başarı **canlı API, stok veya kasa fiyatı** kanıtı değildir.
- SDK iptal testi **masaüstü istemcinin Stop/timeout kabulü** değildir.
- Deneysel erişimin açık olması endpoint’in çalıştığını göstermez.
- Boş şube teklifi “stok yok”; küçük live test “güvenli kota/büyük yük” anlamına gelmez.
- Sahte registry testleri gerçek OIDC yetkisini veya npm/MCP Registry yayınını kanıtlamaz.

<details>
<summary>Teknik test kapsamı</summary>

### Sözleşme ve veri

Kesin ID aramasında beklenmeyen/tekrarlı ürünler, zincir anahtarı, sayfalama toplamı ve sınırlar
sınanır. Endpoint allowlist’i `toString` / `__proto__` gibi miras alınan anahtarları reddeder.
Seçilmemiş şubeler hesaba katılmaz; sıfır/kuruşa yuvarlanan teklifler ham alanları ve bağlantılarıyla korunur.
Eşit fiyat sırası locale’den bağımsızdır; geçmişteki null gözlemler kaybolmaz.
Kategori sorguları NFC/NFD eşdeğerliğini, Türkçe harf ayrımını ve ham ad/path korunmasını sınar.

### Kaynak ve hata sınırları

Girdi, ürün, offer ve uyarı bütçeleri sepet boyunca birikir; ham alanlar da sayılır.
Uyarı ve ürün sınırları metadata genişletilmeden denetlenir; offer’sız ürünler de sayılır.
JSON derinliği/değer sayısı/byte/Unicode/escape/sonluluk sınanır; ilk geçersiz alanda durulur.
Uzun facet anahtarları hataya kopyalanmaz. Büyük/geçersiz hatalar sabit, sınırlı MCP hatasına dönüşür.
Aşım kısmi başarı sayılmaz; kabul edilmiş ek alanlar ve uyarılar korunur.

### SDK ve ağ

`0`/boş string istek ID’si, erken iptal, iki yönde yinelenen ID, yanıt callback’inde ID’nin yeniden
kullanılması ve kapanış temizliği sınanır. Bellek içi SDK ve stdio testleri vardır.
Çok şubeli/eşit fiyatlı büyüme testi alan erişimlerini sayar; süre eşiği veya live yük testi değildir.
Ağ koruması fetch, TCP, HTTP(S), TLS ve HTTP/2’yi izole süreçte dener; DNS, UDP ve tüm özel HTTP/2
sağlayıcılarını kapsadığı iddia edilmez.

### Dağıtım ve CI

Paket arşivi açık dosya listesine göre sınanır; checkout bağımlılıklarıyla CLI ve offline MCP açılır.
Bağımsız tüketici testi boşluk içeren dizin, ayrı cache ve `--omit=dev --ignore-scripts` kullanır;
initialize, tool/resource/prompt keşfi, sürüm, status ve sıfır HTTP denemeli `NETWORK_DISABLED` doğrulanır.
Yayın işi aynı arşivi kurar. Registry testleri yeni/tarihsel latest, geçici hatalar, Retry-After,
gövde okuma ve toplam deadline’ı sınar; yeniden publish yapılmaz.

CI: Ubuntu Node 22/24 ve macOS Node 24. Tüketici kurulumu: Ubuntu Node 22 / Windows Node 24.
Üretim bağımlılığı denetimi npm advisory servisine bağlanır. Lint kullanılmayan değişken ve açık `any`yi reddeder.

</details>

Bu belge test kapsamıdır; oturum sonucu değildir. Yanıtları yorumlamak için [API sözleşmesine](api.md) bakın.
Market listesine erişim garanti edilmez; hatası aramayı ve karşılaştırmayı engellemez.
