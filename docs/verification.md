# Doğrulama kapsamı

Kaynak deponun klonunda şu komutu çalıştırın:

```sh
MARKET_FIYATI_MODE=offline npm run check
```

**Beklenen sonuç:** Biçim, lint, tip kontrolü, derleme ve otomatik testler geçer. Testler sentetik veriler
ve fake fetch kullanır. `tests/no-network.mjs` gerçek ağ erişimini engeller.

## Neler test ediliyor?

| Alan            | Kapsam                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sözleşmeler     | Girdi ve yanıt şemaları, kesin ID sorgularında beklenmeyen veya tekrarlı ID'lerin reddi, zincir anahtarı, sayfalamadaki toplam ve sınır koşulları. Yalnızca allowlist'in kendi endpoint anahtarları kabul edilir; `toString` veya `__proto__` gibi miras kalan anahtarlar reddedilir. |
| Para ve sepet   | Kuruş hesabı, eksik sepet toplamları, locale'den bağımsız eşitlik çözümü, fiyat geçmişi ve null gözlemler                                                                                                                                                                             |
| Kapsam ve kanıt | Seçilmemiş şubelerin offer'larının hesaba katılmaması; sıfır veya kuruşa yuvarlanınca sıfır olan offer'ların ham alanları ve değerlendirme bağlantılarıyla korunması                                                                                                                  |
| Transport       | Hatalar, retry, timeout ve iptal, FIFO kapasitesi; bekleyen iptallerin ve dinleyicilerin temizlenmesi                                                                                                                                                                                 |
| Dağıtım         | npm arşivinin açık dosya listesine uyması; arşivden açılan CLI ve offline MCP'nin checkout bağımlılıklarıyla çalışması                                                                                                                                                                |

Yayın testleri ayrıca şunları sahte registry yanıtlarıyla sınar: tag ile `main` arasındaki ilişki, OIDC
workflow adımlarının sırası, daha önce kullanılmış sürümlerin tekrar gönderilmemesi ve registry integrity
kontrolü. Yeni yayın için latest eşleşmesi, daha yeni latest ile tarihsel doğrulama, geçici post-publish hataları, Retry-After ve HTTP sürelerini içeren toplam deadline da ağ isteği göndermeden sınanır. Bu testler gerçek GitHub OIDC yetkilendirmesini veya gerçek bir npm yayınını kanıtlamaz.

### Bağımsız npm tüketici kontrolü

`npm run test:consumer` ayrı bir kurulum kontrolüdür; normal `npm run check` içine ağ erişimi eklemez.
Boşluk içeren geçici dizin, ayrı npm cache ve `--omit=dev --ignore-scripts` kullanır. Runtime
bağımlılıkları checkout'tan bağlanmaz. npm'in oluşturduğu binary üzerinden initialize, tool/resource/prompt
keşfi, sürüm, offline status ve sıfır HTTP denemeli `NETWORK_DISABLED` sonucu doğrulanır.
Uygulama sürecinde ağ engelleyici etkin kalır; kurulum npm registry'ye bağlanabilir.
CI'da Ubuntu Node 22 ve Windows Node 24 için tanımlıdır; release işi yayımlayacağı aynı arşivi ayrıca sınar.
Bu otomasyon gerçek masaüstü istemcisinin Stop düğmesi veya timeout kabulü değildir.

Kararlı status, sepet, ürün karşılaştırması ve fiyat geçmişi çıktılarının outputSchema alanları
keşif üzerinden sınanır. Yanlış alan tipleri reddedilir; nullable fiyatlar, upstream ek alanlar ve
text/structuredContent eşitliği korunur.

### Kaynak ve hata sınırları

| Kontrol             | Beklenen davranış                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bütçeler            | Kaynak, ürün, offer ve uyarı toplamları sepet boyunca birikir. Korunan ham veri de bu toplamlara dâhildir.                                          |
| Erken sınırlandırma | Uyarı sınırı aşılırsa uyarılar genişletilmeden, ürün sınırı aşılırsa (offer'ı olmayan ürünler dâhil) şube metadata'sı üretilmeden istek reddedilir. |
| JSON                | Derinlik, değer sayısı, byte boyutu, Unicode ve escape karakterleri ile sonlu olmayan sayılar denetlenir. İlk geçersiz alanda durulur.              |
| Tanılama            | Uzun facet anahtarları hata mesajına kopyalanmaz. Büyük veya geçersiz bir hata, boyutu sınırlı sabit bir MCP hatasına dönüşür.                      |
| Aşım                | Kısmi başarı yerine açık hata döner. Kabul edilmiş ek alanlar ve uyarılar korunur.                                                                  |

### SDK ve geliştirme

- **SDK:** `0` veya boş string istek kimliği, erken iptal, iki yönde yinelenen kimlik, bir kimliğin yanıt
  callback'i içinde hemen yeniden kullanılması ve kapanışta temizlik.
- **Entegrasyon:** Bellek içi SDK ve stdio testleri. Bu testlerin başarısı, gerçek bir masaüstü istemcide
  kabul testi yapıldığı anlamına gelmez.
- **Lint:** Geçerli TypeScript kabul edilir; kullanılmayan değişken ve açık `any` reddedilir.
- **Büyüme testi:** Çok sayıda şube ve ayrık eşit fiyat grupları olduğunda alan erişim sayısı ölçülür. Bu bir
  süre eşiği veya live yük testi değildir.
- **Ağ engeli:** İzole bir alt süreçte fetch, TCP, HTTP, HTTPS, TLS ve HTTP/2 denenir; gerçek bağlantı
  kurulmaz. DNS, UDP ve tüm özel HTTP/2 sağlayıcıları için kapsam iddia edilmez.

Kesin kapsam, ilgili sürümün test dosyalarında görülebilir. CI, Ubuntu üzerinde Node 22/24 ve macOS üzerinde
Node 24 ile çalışır. Ayrı bir üretim bağımlılığı denetimi npm advisory servisine bağlanır. Uygulama testleri
Market Fiyatı API'sine bağlanmaz.

## Bu sonuçlar neyi kanıtlamaz?

| Yerel başarı                  | Kanıtlamadığı şey                                                    |
| ----------------------------- | -------------------------------------------------------------------- |
| Sentetik testlerin geçmesi    | Uzak API'ye erişim, gerçek stok, kasadaki fiyat veya kampanya koşulu |
| Deneysel erişimin açık olması | Live doğrulamanın başarılı olduğu                                    |
| Bir şube için offer dönmemesi | Stok olmadığı; kapsam her yanıtta ayrıca değerlendirilir             |
| SDK iptal testinin geçmesi    | Gerçek masaüstü istemcinin timeout veya Stop davranışı               |
| Küçük bir live örnek          | Uzun sepet veya yük desteği ya da güvenli bir kota                   |

Market listesi endpoint'ine başarılı erişim garanti edilmez. Bu endpoint'teki hata, aramayı ve
karşılaştırmayı engellemez. Bu belge yalnızca kapsamı açıklar; test oturumu sonucu veya ham ölçüm içermez.

**Sonraki adım:** [Sentetik istemci kabulü](offline-acceptance.md) ya da kullanıcı açıkça başlattığında
[live test](live-testing.md). Yanıtların nasıl yorumlanacağı [API sözleşmesinde](api.md) anlatılır.
