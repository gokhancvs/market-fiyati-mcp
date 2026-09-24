# Doğrulama kapsamı

**Kaynak depo klonunda çalıştırın:**

```sh
MARKET_FIYATI_MODE=offline npm run check
```

**Beklenen:** Biçim, lint, tip kontrolü, derleme ve otomatik testler geçer.
Testler sentetik girdiler/sahte fetch kullanır; `tests/no-network.mjs` gerçek ağ erişimini engeller.

## Neler sınanıyor?

| Alan            | Kapsam                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Sözleşmeler     | Girdi/yanıt şemaları, kesin ID'ler, zincir anahtarı, sayfalama toplam/sınır koşulları; yalnız doğrudan endpoint allowlist anahtarları  |
| Para ve sepet   | Kuruş hesabı, eksik toplamlar, locale bağımsız eşitlik çözümü, geçmiş fiyat/null gözlemler                                             |
| Kapsam ve kanıt | Seçilmemiş tekliflerin hesap dışı kalması; sıfır/sıfıra yuvarlanan tekliflerin ham alanları ve değerlendirme bağlantılarıyla korunması |
| Taşıma          | Hatalar, retry, timeout/iptal, FIFO kapasitesi; bekleyen iptal/dinleyici temizliği                                                     |
| Dağıtım         | npm arşivinin çalışma dosyalarıyla sınırlanması, arşivden CLI ve offline MCP çalışması                                                 |

Yayın testleri ayrıca tag/main ilişkisini, OIDC workflow sırasını, kullanılmış sürümlerin
yeniden gönderilmemesini ve registry integrity kontrolünü sahte registry yanıtlarıyla sınar.
Bu kontroller gerçek GitHub OIDC yetkilendirmesini veya npm yayınını kanıtlamaz.

### Kaynak ve hata sınırları

| Kontrol             | Beklenen davranış                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Bütçeler            | Kaynak/ürün/teklif/uyarı toplamları sepet boyunca birikir; ham korunan veri de sayılır               |
| Erken sınırlandırma | Uyarılar genişletilmeden, teklifsiz ürünler şube metadata'sı büyütülmeden reddedilir                 |
| JSON                | Derinlik/değer/byte, Unicode/escape ve sonlu olmayan sayılar denetlenir; ilk geçersiz alanda durulur |
| Tanılama            | Uzun facet anahtarları hataya kopyalanmaz; büyük/geçersiz hata sabit bütçeli MCP hatasına dönüşür    |
| Aşım                | Kısmi başarı yerine açık hata; kabul edilen ek alan ve uyarılar korunur                              |

### SDK ve geliştirme

- SDK: `0`/boş kimlik, erken iptal, iki yönde yinelenen kimlik, yanıt callback'inde hemen yeniden kullanım ve kapanış temizliği.
- Entegrasyon: bellek içi SDK ve stdio; başarının gerçek masaüstü kabulü sayılmaması.
- Lint: geçerli TypeScript kabul; kullanılmayan değişken ve açık `any` reddi.
- Büyüme testi: çok şube/ayrık eşit fiyat kümelerinde alan erişimi sayısı; süre eşiği veya canlı yük testi değil.
- Ağ engeli: izole alt süreçte fetch, TCP, HTTP, HTTPS, TLS, HTTP/2; gerçek bağlantı kurulmaz.
  DNS/UDP ve tüm özel HTTP/2 sağlayıcıları için kapsam iddia edilmez.

Kesin kapsam ilgili sürümün test dosyalarındadır. CI: Ubuntu Node 22/24, macOS Node 24;
ayrı üretim bağımlılığı denetimi npm advisory servisine erişir. Uygulama testleri Market Fiyatı API'sine bağlanmaz.

## Bu sonuçlar neyi kanıtlamaz?

| Yerel başarı         | Kanıtlamadığı şey                                               |
| -------------------- | --------------------------------------------------------------- |
| Sentetik test        | Uzak API erişimi, gerçek stok, kasa fiyatı veya kampanya koşulu |
| Deneysel erişim açık | Başarılı canlı doğrulama                                        |
| Teklif dönmedi       | Stok yokluğu; kapsam her yanıtta ayrıca değerlendirilir         |
| SDK iptal testi      | Gerçek masaüstü istemcisinin timeout/Stop davranışı             |
| Küçük canlı örnek    | Uzun sepet/yük desteği veya güvenli kota                        |

Market listesine başarılı erişim garantisi yoktur; bu uçtaki hata bağımsız arama/karşılaştırmayı engellemez.
Bu belge kapsamı açıklar, oturum sonucu veya ham ölçüm dökümü içermez.

**Sonraki kontrolü seçin:** [Sentetik istemci kabulü](offline-acceptance.md) veya
kullanıcının açık test başlangıcıyla [canlı test](live-testing.md).
Yanıt yorumları [API sözleşmesindedir](api.md).
