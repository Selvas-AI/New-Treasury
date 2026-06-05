# GAS Code.gs — 종목명/채권명 검색 추가 패치

> 작성일: 2026-06-04  
> 적용 대상: 기존 GAS Web App (Code.gs)

---

## 1. doGet() 함수 — 라우팅 추가

기존 `doGet` 내부에서 `if (p.ticker)` 분기 **앞**에 아래 두 블록을 추가합니다.

```javascript
// ── [추가] 이름으로 주식 검색: ?name=셀바스에이아이
if (p.name && !p.ticker) {
  return searchStockByName_(p.name);
}

// ── [추가] 이름으로 채권 검색: ?type=bond&bondName=국고채권
if (p.type === 'bond' && p.bondName && !p.isinCd) {
  return searchBondByName_(p.bondName);
}
```

---

## 2. 신규 함수 — 파일 맨 끝에 추가

```javascript
/* ================================================================
   종목명으로 주식 검색 (KRX finder → 주가 조회)
   호출: ?name=셀바스에이아이
   응답: { success, ticker, name, market, price, date, change,
           changeRate, symbol, candidates[] }
   ================================================================ */
function searchStockByName_(name) {
  try {
    // 1. KRX finder로 종목코드 검색
    var krxRes = UrlFetchApp.fetch(
      'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd',
      {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'bld=dbms%2Fcomm%2Ffinder%2Ffinder_stkisu'
               + '&searchText=' + encodeURIComponent(name)
               + '&mktsel=ALL',
        headers: { 'Referer': 'https://data.krx.co.kr' },
        muteHttpExceptions: true
      }
    );

    var krxData = JSON.parse(krxRes.getContentText());
    var items   = krxData.block1 || [];

    if (items.length === 0) {
      return makeJson_({ success: false, error: '종목을 찾을 수 없습니다: ' + name });
    }

    // 2. 후보 목록 (최대 5개)
    var candidates = items.slice(0, 5).map(function(i) {
      return {
        ticker: i.short_code,
        name:   i.codeName,
        market: i.marketCode === 'KSQ' ? 'KOSDAQ' : 'KOSPI'
      };
    });

    // 3. 첫 번째 결과로 주가 조회 (기존 내부 함수 재사용)
    //    ※ 아래 getStockPrice_(ticker) 는 기존 doGet에서 ticker 처리하는
    //      내부 함수명으로 교체하세요.
    var ticker = items[0].short_code;
    var priceData = getStockPrice_(ticker);   // ← 기존 내부 주가 조회 함수

    return makeJson_(Object.assign({}, priceData, {
      success:    true,
      ticker:     ticker,
      name:       items[0].codeName,
      market:     items[0].marketCode === 'KSQ' ? 'KOSDAQ' : 'KOSPI',
      candidates: candidates
    }));

  } catch(e) {
    return makeJson_({ success: false, error: '이름 검색 실패: ' + e.toString() });
  }
}

/* ================================================================
   채권명으로 채권 검색 (KRX finder → 기준가 조회)
   호출: ?type=bond&bondName=국고채권
   응답: { success, isinCd, name, price, date, candidates[] }
   ================================================================ */
function searchBondByName_(bondName) {
  try {
    // 1. KRX finder로 ISIN 검색
    var krxRes = UrlFetchApp.fetch(
      'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd',
      {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'bld=dbms%2Fcomm%2Ffinder%2Ffinder_bondisu'
               + '&searchText=' + encodeURIComponent(bondName)
               + '&mktsel=ALL',
        headers: { 'Referer': 'https://data.krx.co.kr' },
        muteHttpExceptions: true
      }
    );

    var text = krxRes.getContentText();

    // HTML 응답 → 접근 제한
    if (text.trimStart().charAt(0) === '<') {
      return makeJson_({
        success: false,
        error: '채권 KRX 검색 불가. ISIN 코드를 직접 입력해주세요.'
      });
    }

    var krxData = JSON.parse(text);
    var items   = krxData.block1 || [];

    if (items.length === 0) {
      return makeJson_({ success: false, error: '채권을 찾을 수 없습니다: ' + bondName });
    }

    var candidates = items.slice(0, 5).map(function(i) {
      return { isin: i.isin_cd, name: i.codeName };
    });

    // 2. 첫 번째 결과로 기준가 조회
    //    ※ 아래 getBondPrice_(isin) 은 기존 doGet의 isinCd 처리 내부 함수명으로 교체
    var isin      = items[0].isin_cd;
    var priceData = getBondPrice_(isin);     // ← 기존 내부 채권 조회 함수

    return makeJson_(Object.assign({}, priceData, {
      success:    true,
      isinCd:     isin,
      name:       items[0].codeName,
      candidates: candidates
    }));

  } catch(e) {
    return makeJson_({ success: false, error: '채권 이름 검색 실패: ' + e.toString() });
  }
}

/* ----------------------------------------------------------------
   makeJson_ 헬퍼 — 기존 코드에 없으면 함께 추가
   ---------------------------------------------------------------- */
function makeJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 3. 적용 방법

1. GAS 에디터(`script.google.com`)에서 `Code.gs` 열기
2. `doGet` 함수 내 **`if (p.ticker)` 바로 앞**에 라우팅 블록 삽입
3. 파일 맨 끝에 신규 함수 2개 + `makeJson_` 추가
4. `getStockPrice_()`, `getBondPrice_()` → **실제 내부 함수명**으로 수정
   - 기존 코드에서 `p.ticker` 처리하는 로직을 별도 함수로 분리하거나
   - 해당 블록의 반환 객체를 직접 복사해 사용 가능
5. **새 배포(Deploy → Manage deployments → New version)** 후 URL 갱신 없이 반영됨

---

## 4. 응답 예시

### 주식 (성공)
```json
{
  "success": true,
  "ticker": "108860",
  "name": "셀바스AI",
  "market": "KOSDAQ",
  "price": 9870,
  "date": "2026-06-04",
  "change": -10,
  "changeRate": -0.10,
  "symbol": "108860",
  "candidates": [
    { "ticker": "108860", "name": "셀바스AI", "market": "KOSDAQ" },
    { "ticker": "208370", "name": "셀바스헬스케어", "market": "KOSDAQ" }
  ]
}
```

### 채권 (성공)
```json
{
  "success": true,
  "isinCd": "KR103502GCC5",
  "name": "국고채권 03250-2712(22-14)",
  "price": 9850.5,
  "date": "2026-06-03",
  "candidates": [
    { "isin": "KR103502GCC5", "name": "국고채권 03250-2712(22-14)" }
  ]
}
```
