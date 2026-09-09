/**
 * ╔════════════════════════════════════════════════════════════════════╗
 * ║  Google Apps Script: Stock & Bond Price Fetcher v4               ║
 * ║                                                                    ║
 * ║  v4 추가:                                                          ║
 * ║    FX 표준편차 자동계산 (한국은행 ECOS API)                        ║
 * ║    스크립트 속성 추가 필요:                                         ║
 * ║      ECOS_API_KEY : 한국은행 ECOS API 인증키                       ║
 * ║      (발급: https://ecos.bok.or.kr/api/#/ → 무료 회원가입 후 발급) ║
 * ║                                                                    ║
 * ║  v3 주요 변경:                                                     ║
 * ║    주식: 공공데이터포털 금융위원회 주식시세 API 우선 사용          ║
 * ║          (Yahoo Finance 등락 오류 문제 근본 해결)                  ║
 * ║    폴백: 네이버 증권 → Yahoo Finance                               ║
 * ║    채권: 공공데이터포털 채권 API (기존 유지)                       ║
 * ║    환율: 네이버 금융 (기존 유지)                                   ║
 * ║                                                                    ║
 * ║  스크립트 속성 필요:                                               ║
 * ║    STOCK_API_KEY : 공공데이터포털 주식 API 인증키                  ║
 * ║    BOND_API_KEY  : 공공데이터포털 채권 API 인증키 (같아도 됨)      ║
 * ╚════════════════════════════════════════════════════════════════════╝
 */

const TIMEOUT_MS = 25000;  // GAS 내부 외부 API 타임아웃 25초 (Web App 실행 한도 30초 이내)

function doGet(e) {
  try {
    const type = (e.parameter.type || '').trim().toLowerCase();

    // ── FX 표준편차 자동계산: ?type=fxstddev ──────────────────────
    if (type === 'fxstddev') return calcFxStdDevFromEcos_(e);

    // ── FX 일별 환율 이력: ?type=fxhistory&currency=USD&from=YYYYMMDD&to=YYYYMMDD ──
    if (type === 'fxhistory') return fetchFxHistoryFromEcos_(e);

    // ── 공휴일 조회: ?type=holidays&year=YYYY ─────────────────────
    if (type === 'holidays') return fetchKoreanHolidays_(e);

    // ── 결재 요청 메일 발송: ?type=approvalnotify&reportId=<uuid> ──
    //   자금일보 화면이 상신·승인 직후 호출한다(즉시 발송).
    //   reportId 외의 정보는 받지 않는다 — 수신자·내용은 서버가 DB에서 결정한다.
    if (type === 'approvalnotify') return sendApprovalNotify_(e);

    if (type === 'bond') {
      // ── 채권명으로 검색: ?type=bond&bondName=국고채권 ──────────
      if (e.parameter.bondName && !e.parameter.isinCd) {
        return searchBondByName_(e.parameter.bondName.trim());
      }
      return fetchBondPrice(e);
    }
    if (type === 'fx') return fetchNaverFX(e);

    // ── 종목명으로 검색: ?name=셀바스에이아이 ────────────────────
    const searchName = (e.parameter.name || '').trim();
    if (searchName && !e.parameter.ticker && !e.parameter.symbol) {
      return searchStockByName_(searchName);
    }

    // ── 주가 조회 ──────────────────────────────────────────────────
    const ticker = (e.parameter.ticker || e.parameter.symbol || '').trim().replace(/\.(KQ|KS)$/, '');
    if (!ticker) return createResponse({ success: false, error: 'ticker 필요' }, 400);

    const code6 = ticker.padStart(6, '0');
    // basDt: YYYYMMDD (과거 종가 조회) 없으면 최근 영업일 자동 사용
    const basDt = (e.parameter.basDt || '').trim() || null;
    Logger.log('주가 조회: ' + code6 + (basDt ? ' basDt=' + basDt : ' (최신)'));

    let result = null;
    if (basDt) {
      // 과거 종가: 공공데이터포털 전용 (네이버·Yahoo는 과거 일자 조회 불가)
      result = fetchViaPublicData(code6, basDt);
    } else {
      // 실시간: 네이버(장중 시세) 우선 → 공공데이터(T+1) → Yahoo 순 폴백
      result = fetchViaNaver(code6);
      if (!result) {
        Logger.log('네이버 실패, 공공 API 시도');
        result = fetchViaPublicData(code6, null);
      }
      if (!result) {
        Logger.log('공공 API 실패, Yahoo 시도');
        result = fetchViaYahoo(code6 + '.KQ');
        if (!result) result = fetchViaYahoo(code6 + '.KS');
      }
    }

    if (!result) return createResponse({ success: false, error: code6 + ' 주가 조회 실패' }, 503);

    return createResponse({
      success:    true,
      price:      result.price,
      prevClose:  result.prevClose  || null,
      change:     result.change     || null,
      changeRate: result.changeRate || null,
      date:       result.date,
      source:     result.source,
      symbol:     code6
    }, 200);

  } catch (err) {
    Logger.log('doGet ERROR: ' + err.toString());
    return createResponse({ success: false, error: err.toString().slice(0, 100) }, 500);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  1순위: 공공데이터포털 금융위원회 주식 시세 API
//  서비스: GetStockSecuritiesInfoService / getStockPriceInfo
//  등락 필드: vs (전일대비), fltRt (등락률)
// ══════════════════════════════════════════════════════════════════════
function fetchViaPublicData(code6, basDt) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('STOCK_API_KEY');
    if (!apiKey) {
      Logger.log('STOCK_API_KEY 없음 — 공공 API 건너뜀');
      return null;
    }

    // basDt: YYYYMMDD 지정 시 해당 날짜 종가, 없으면 최근 영업일
    const queryDate = basDt || getRecentBusinessDate();

    // ⚠️ 종목 필터는 반드시 likeSrtnCd(단축코드) 사용.
    //    stckIscd 는 이 API가 인식하지 못하는 파라미터 → basDt 만 적용되어
    //    "그 날짜의 첫 번째 종목"이 반환되는 치명 버그 발생(엉뚱한 주가).
    //    numOfRows 를 넉넉히 받아 srtnCd === code6 인 행을 직접 선택해 안전성 확보.
    const url = 'https://apis.data.go.kr/1160100/service/'
              + 'GetStockSecuritiesInfoService/getStockPriceInfo'
              + '?serviceKey=' + encodeURIComponent(apiKey)
              + '&resultType=json'
              + '&numOfRows=20&pageNo=1'
              + '&likeSrtnCd=' + code6
              + '&basDt=' + queryDate;

    Logger.log('공공 주식 API 호출: ' + url.replace(apiKey, 'API_KEY'));

    const resp = UrlFetchApp.fetch(url, {
      method: 'get', muteHttpExceptions: true, timeout: TIMEOUT_MS
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log('공공 주식 API HTTP ' + resp.getResponseCode());
      return null;
    }

    const data  = JSON.parse(resp.getContentText());
    const body  = data.response && data.response.body;
    const items = body && body.items && body.items.item;
    const list  = Array.isArray(items) ? items : (items ? [items] : []);

    // 단축코드(srtnCd)가 정확히 일치하는 행만 선택 — like 검색의 오매칭 방지
    let item = list.find(function(it) {
      return it && String(it.srtnCd || '').replace(/^A/, '') === code6;
    }) || null;

    if (!item || !item.clpr) {
      Logger.log('공공 주식 API 데이터 없음(정확 매칭 실패): ' + code6 + ' / rows=' + list.length);
      return null;
    }

    const price     = parseInt(item.clpr  || 0, 10);    // 종가
    const prevClose = parseInt(item.basPrc || 0, 10);   // 기준가 (전일 종가)
    const vs        = parseInt(item.vs    || 0, 10);    // 전일대비 등락
    const fltRt     = parseFloat(item.fltRt || 0);      // 등락률

    if (!price) return null;

    Logger.log('공공 주식 ✓ ' + code6 + ': ' + price + '원 vs:' + vs + ' 등락률:' + fltRt + '%');

    return {
      price,
      prevClose: prevClose || (price - vs),
      change:    vs,
      changeRate: fltRt,
      date:      item.basDt ? item.basDt.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : today,
      source:    'data.go.kr/stock'
    };

  } catch (e) {
    Logger.log('fetchViaPublicData ERROR: ' + e.toString());
    return null;
  }
}


// ══════════════════════════════════════════════════════════════════════
//  2순위: 네이버 증권 (장중 실시간)
// ══════════════════════════════════════════════════════════════════════
function fetchViaNaver(code6) {
  const url = 'https://m.stock.naver.com/api/stock/' + code6 + '/basic';
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'application/json',
        'Referer': 'https://m.stock.naver.com/'
      },
      muteHttpExceptions: true,
      timeout: TIMEOUT_MS
    });
    if (resp.getResponseCode() !== 200) return null;

    const d = JSON.parse(resp.getContentText());

    // 네이버는 숫자를 "16,750" 콤마 포함 문자열로 반환 → 콤마 제거 후 파싱
    const cleanNum = function(v) {
      if (v === null || v === undefined) return 0;
      return parseFloat(String(v).replace(/,/g, '')) || 0;
    };

    const price      = Math.round(cleanNum(d.closePrice || d.currentPrice));
    if (!price) return null;

    const change     = d.compareToPreviousClosePrice != null ? Math.round(cleanNum(d.compareToPreviousClosePrice)) : null;
    const changeRate = d.fluctuationsRatio != null ? parseFloat(String(d.fluctuationsRatio).replace(/,/g,'')) : null;
    const prevClose  = (change !== null) ? price - change : null;

    Logger.log('네이버 ✓ ' + code6 + ': ' + price + '원 등락:' + change + '(' + changeRate + '%)');
    return { price, prevClose, change, changeRate, date: formatDate(new Date()), source: 'naver' };

  } catch (e) {
    Logger.log('fetchViaNaver ERROR: ' + e.toString());
    return null;
  }
}


// ══════════════════════════════════════════════════════════════════════
//  3순위: Yahoo Finance (최후 폴백)
// ══════════════════════════════════════════════════════════════════════
function fetchViaYahoo(symbol) {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
              + encodeURIComponent(symbol)
              + '?interval=1d&range=2d&includePrePost=false';

    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'User-Agent': getRandomUserAgent(), 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' },
      muteHttpExceptions: true,
      timeout: TIMEOUT_MS
    });
    if (resp.getResponseCode() !== 200) return null;

    const data   = JSON.parse(resp.getContentText());
    const result = data.chart && data.chart.result && data.chart.result[0];
    if (!result) return null;
    const meta = result.meta || {};

    const price = meta.regularMarketPrice ? Math.round(meta.regularMarketPrice) : null;
    if (!price) return null;

    const prevClose  = meta.previousClose ? Math.round(meta.previousClose) : (meta.chartPreviousClose ? Math.round(meta.chartPreviousClose) : null);
    const change     = prevClose ? price - prevClose : null;
    const changeRate = (prevClose && prevClose > 0) ? Math.round((change / prevClose) * 10000) / 100 : null;

    Logger.log('Yahoo ✓ ' + symbol + ': ' + price + '원');
    return {
      price, prevClose, change, changeRate,
      date:   meta.regularMarketTime ? formatDate(new Date(meta.regularMarketTime * 1000)) : formatDate(new Date()),
      source: 'yahoo'
    };
  } catch (e) {
    Logger.log('fetchViaYahoo ERROR: ' + e.toString());
    return null;
  }
}


// ══════════════════════════════════════════════════════════════════════
//  채권 시세 조회
// ══════════════════════════════════════════════════════════════════════
function fetchBondPrice(e) {
  try {
    const isinCd = (e.parameter.isinCd || '').trim();
    const basDt  = (e.parameter.basDt  || '').trim();
    if (!isinCd) return createResponse({ success: false, error: 'isinCd 필요' }, 400);

    const apiKey = PropertiesService.getScriptProperties().getProperty('BOND_API_KEY')
                || PropertiesService.getScriptProperties().getProperty('STOCK_API_KEY');
    if (!apiKey) return createResponse({ success: false, error: 'API 키 없음' }, 500);

    // basDt 없으면 최근 10일치 조회 → 가장 최근 유효 데이터 사용 (T+1 지연 대응)
    const numRows = basDt ? '3' : '10';
    let url = 'https://apis.data.go.kr/1160100/service/'
            + 'GetBondSecuritiesInfoService/getBondPriceInfo'
            + '?serviceKey=' + encodeURIComponent(apiKey)
            + '&resultType=json&numOfRows=' + numRows
            + '&isinCd=' + encodeURIComponent(isinCd);
    if (basDt) url += '&basDt=' + basDt;
    else {
      // basDt 미지정 시 최근 날짜부터 내림차순으로 조회
      url += '&beginBasDt=&endBasDt=&sortField=basDt&sortOrder=desc';
    }

    const resp = UrlFetchApp.fetch(url, { method:'get', muteHttpExceptions:true, timeout:TIMEOUT_MS });
    if (resp.getResponseCode() !== 200) return createResponse({ success:false, error:'HTTP ' + resp.getResponseCode() }, 502);

    const data  = JSON.parse(resp.getContentText());
    const items = data.response && data.response.body && data.response.body.items && data.response.body.items.item;

    let item = null;
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].clprPrc && parseFloat(items[i].clprPrc) > 0) { item = items[i]; break; }
      }
    } else if (items && items.clprPrc) { item = items; }

    if (!item) return createResponse({ success:false, error: isinCd + ' 데이터 없음' }, 404);

    return createResponse({
      success: true,
      price:   parseFloat(item.clprPrc),
      rate:    parseFloat(item.clprBnfRt) || null,
      date:    item.basDt ? item.basDt.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : formatDate(new Date()),
      isinCd:  item.isinCd,
      name:    item.itmsNm || isinCd,
      market:  item.mrktCtg || '',
      clprVs:  parseFloat(item.clprVs) || 0,
      source:  'data.go.kr/bond'
    }, 200);

  } catch (err) {
    Logger.log('fetchBondPrice ERROR: ' + err.toString());
    return createResponse({ success:false, error: err.toString().slice(0,150) }, 500);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  환율 조회
// ══════════════════════════════════════════════════════════════════════
function fetchNaverFX(e) {
  try {
    const resp = UrlFetchApp.fetch('https://open.er-api.com/v6/latest/USD', {
      method: 'get', muteHttpExceptions: true, timeout: 8000
    });
    if (resp.getResponseCode() !== 200)
      return createResponse({ success: false, error: 'FX API 오류' });

    const data = JSON.parse(resp.getContentText());
    const r = data.rates;
    if (!r || !r.KRW)
      return createResponse({ success: false, error: '환율 데이터 없음' });

    const krw = r.KRW;  // 1 USD = krw원
    const rates = {
      USD: Math.round(krw * 100) / 100,
      EUR: Math.round(krw / r.EUR * 100) / 100,
      JPY: Math.round(krw / r.JPY * 100) / 100,   // 1엔당 (사이드바에서 ×100 = 100엔당)
      GBP: Math.round(krw / r.GBP * 100) / 100,
      CNY: Math.round(krw / r.CNY * 100) / 100,
    };

    return createResponse({
      success: true, rates,
      date: formatDate(new Date()), source: 'open.er-api.com', fetched: 5
    });
  } catch (err) {
    return createResponse({ success: false, error: err.toString().slice(0, 100) });
  }
}


// ══════════════════════════════════════════════════════════════════════
//  공통 유틸
// ══════════════════════════════════════════════════════════════════════
function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function formatDate(date) {
  return date.getFullYear() + '-'
    + String(date.getMonth()+1).padStart(2,'0') + '-'
    + String(date.getDate()).padStart(2,'0');
}

// 최근 영업일 (주말이면 금요일로 이동)
function getRecentBusinessDate() {
  const d = new Date();
  // KST = UTC+9
  d.setHours(d.getHours() + 9);
  // 장 마감 전(15:30 이전)이면 어제도 포함 가능하나 API가 당일 데이터 제공
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2); // 일요일 → 금요일
  if (day === 6) d.setDate(d.getDate() - 1); // 토요일 → 금요일
  return d.getFullYear()
    + String(d.getMonth()+1).padStart(2,'0')
    + String(d.getDate()).padStart(2,'0');
}

function getRandomUserAgent() {
  const ua = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  ];
  return ua[Math.floor(Math.random() * ua.length)];
}


// ══════════════════════════════════════════════════════════════════════
//  종목명 / 채권명으로 검색 (KRX finder 연동)
// ══════════════════════════════════════════════════════════════════════

/**
 * 주가 조회 내부 헬퍼 — code6(6자리)로 주가 결과 객체 반환
 * doGet 의 1~3순위 폴백 로직을 재사용
 */
function getStockPriceByCode_(code6) {
  let result = fetchViaPublicData(code6);
  if (!result) {
    Logger.log('공공 API 실패, 네이버 시도');
    result = fetchViaNaver(code6);
  }
  if (!result) {
    Logger.log('네이버 실패, Yahoo 시도');
    result = fetchViaYahoo(code6 + '.KQ');
    if (!result) result = fetchViaYahoo(code6 + '.KS');
  }
  return result; // null 또는 { price, prevClose, change, changeRate, date, source }
}

/**
 * 채권 기준가 조회 내부 헬퍼 — isinCd 문자열로 응답 객체 반환
 */
function getBondPriceByIsin_(isinCd) {
  const resp = fetchBondPrice({ parameter: { type: 'bond', isinCd: isinCd } });
  return JSON.parse(resp.getContent());
}

/**
 * 종목명으로 주식 검색 + 주가 조회
 * 호출: ?name=셀바스에이아이
 * 응답: { success, ticker, name, market, price, date, change, changeRate,
 *         symbol, source, candidates[] }
 */
function searchStockByName_(name) {
  try {
    Logger.log('종목명 검색: ' + name);

    // 1. KRX finder로 종목코드 검색
    const krxRes = UrlFetchApp.fetch(
      'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd',
      {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'bld=dbms%2Fcomm%2Ffinder%2Ffinder_stkisu'
               + '&searchText=' + encodeURIComponent(name)
               + '&mktsel=ALL',
        headers: { 'Referer': 'https://data.krx.co.kr' },
        muteHttpExceptions: true,
        timeout: TIMEOUT_MS
      }
    );

    const krxData = JSON.parse(krxRes.getContentText());
    const items   = krxData.block1 || [];

    if (items.length === 0) {
      return createResponse({ success: false, error: '종목을 찾을 수 없습니다: ' + name });
    }

    Logger.log('KRX 검색 결과: ' + items.length + '건');

    // 2. 후보 목록 (최대 5개)
    const candidates = items.slice(0, 5).map(function(i) {
      return {
        ticker: i.short_code,
        name:   i.codeName,
        market: i.marketCode === 'KSQ' ? 'KOSDAQ' : 'KOSPI'
      };
    });

    // 3. 첫 번째 결과로 주가 조회
    const code6  = items[0].short_code.padStart(6, '0');
    const market = items[0].marketCode === 'KSQ' ? 'KOSDAQ' : 'KOSPI';
    const foundName = items[0].codeName;

    const priceResult = getStockPriceByCode_(code6);

    if (!priceResult) {
      // 주가 조회 실패 — 종목 정보만이라도 반환
      Logger.log('주가 조회 실패: ' + code6);
      return createResponse({
        success:    true,
        ticker:     code6,
        name:       foundName,
        market:     market,
        price:      0,
        date:       formatDate(new Date()),
        symbol:     code6,
        candidates: candidates
      });
    }

    Logger.log('종목명 검색 완료: ' + foundName + ' ' + code6 + ' ' + priceResult.price + '원');

    return createResponse({
      success:    true,
      ticker:     code6,
      name:       foundName,
      market:     market,
      price:      priceResult.price,
      prevClose:  priceResult.prevClose  || null,
      change:     priceResult.change     || null,
      changeRate: priceResult.changeRate || null,
      date:       priceResult.date,
      source:     priceResult.source,
      symbol:     code6,
      candidates: candidates
    });

  } catch(err) {
    Logger.log('searchStockByName_ ERROR: ' + err.toString());
    return createResponse({ success: false, error: '이름 검색 실패: ' + err.toString().slice(0, 100) });
  }
}

/**
 * 채권명으로 채권 검색 + 기준가 조회
 * 호출: ?type=bond&bondName=국고채권
 * 응답: { success, isinCd, name, price, date, rate, source, candidates[] }
 */
function searchBondByName_(bondName) {
  try {
    Logger.log('채권명 검색: ' + bondName);

    // 1. KRX finder로 ISIN 검색
    const krxRes = UrlFetchApp.fetch(
      'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd',
      {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'bld=dbms%2Fcomm%2Ffinder%2Ffinder_bondisu'
               + '&searchText=' + encodeURIComponent(bondName)
               + '&mktsel=ALL',
        headers: { 'Referer': 'https://data.krx.co.kr' },
        muteHttpExceptions: true,
        timeout: TIMEOUT_MS
      }
    );

    const text = krxRes.getContentText();

    // HTML 응답 → KRX 채권 finder 접근 제한 (IP/세션 이슈)
    if (text.trimStart().charAt(0) === '<') {
      Logger.log('KRX 채권 finder 접근 제한 — HTML 반환됨');
      return createResponse({
        success: false,
        error: 'KRX 채권 검색 불가. ISIN 코드를 직접 입력해주세요.'
      });
    }

    const krxData = JSON.parse(text);
    const items   = krxData.block1 || [];

    if (items.length === 0) {
      return createResponse({ success: false, error: '채권을 찾을 수 없습니다: ' + bondName });
    }

    Logger.log('KRX 채권 검색 결과: ' + items.length + '건');

    const candidates = items.slice(0, 5).map(function(i) {
      return { isin: i.isin_cd, name: i.codeName };
    });

    // 2. 첫 번째 결과로 기준가 조회
    const isin      = items[0].isin_cd;
    const foundName = items[0].codeName;
    const priceData = getBondPriceByIsin_(isin);

    if (!priceData.success) {
      // 기준가 조회 실패 — 채권 정보만이라도 반환
      Logger.log('채권 기준가 조회 실패: ' + isin);
      return createResponse({
        success:    true,
        isinCd:     isin,
        name:       foundName,
        price:      0,
        date:       formatDate(new Date()),
        candidates: candidates
      });
    }

    Logger.log('채권명 검색 완료: ' + foundName + ' ' + isin + ' ' + priceData.price);

    return createResponse({
      success:    true,
      isinCd:     priceData.isinCd  || isin,
      name:       priceData.name    || foundName,
      price:      priceData.price,
      rate:       priceData.rate    || null,
      date:       priceData.date,
      source:     priceData.source,
      candidates: candidates
    });

  } catch(err) {
    Logger.log('searchBondByName_ ERROR: ' + err.toString());
    return createResponse({ success: false, error: '채권 이름 검색 실패: ' + err.toString().slice(0, 100) });
  }
}

/**
 * 테스트 함수 — GAS 에디터에서 직접 실행
 */
function testStockNameSearch() {
  Logger.log('=== 종목명 검색 테스트 ===');
  const r = JSON.parse(searchStockByName_('셀바스').getContent());
  Logger.log(JSON.stringify(r, null, 2));
}

function testBondNameSearch() {
  Logger.log('=== 채권명 검색 테스트 ===');
  const r = JSON.parse(searchBondByName_('국고채').getContent());
  Logger.log(JSON.stringify(r, null, 2));
}

// ══════════════════════════════════════════════════════════════════════
//  테스트 함수 (GAS 에디터에서 직접 실행)
// ══════════════════════════════════════════════════════════════════════
function testStock() {
  Logger.log('=== 주식 시세 테스트 (공공데이터 우선) ===');
  const stocks = [
    { code:'108860', name:'셀바스에이아이' },
    { code:'208370', name:'셀바스헬스케어' },
    { code:'041920', name:'메디아나' }
  ];
  stocks.forEach(function(s) {
    // 1순위: 공공데이터
    let r = fetchViaPublicData(s.code);
    if (!r) r = fetchViaNaver(s.code);
    if (r) {
      Logger.log('✓ ' + s.name + '(' + r.source + '): '
        + r.price + '원 / 등락: ' + (r.change >= 0 ? '+' : '') + r.change
        + ' (' + (r.changeRate >= 0 ? '+' : '') + r.changeRate + '%)');
    } else {
      Logger.log('✗ ' + s.name + ': 조회 실패');
    }
  });
}

function testBond() {
  const r = JSON.parse(fetchBondPrice({ parameter:{ type:'bond', isinCd:'KR103502GF39' } }).getContent());
  Logger.log(r.success ? '✓ ' + r.name + ' ' + r.price + '원' : '✗ ' + r.error);
}

function testFX() {
  const r = JSON.parse(fetchNaverFX({ parameter:{ type:'fx' } }).getContent());
  if (r.success) Object.entries(r.rates).forEach(([k,v]) => Logger.log('✓ ' + k + ': ' + v));
  else Logger.log('✗ ' + r.error);
}

function testPublicStockAPI() {
  Logger.log('=== 공공데이터 주식 API 직접 테스트 ===');
  const r = fetchViaPublicData('108860');
  Logger.log(JSON.stringify(r));
}


// ══════════════════════════════════════════════════════════════════════
//  운전자금 미입력 알림 메일 (매 영업일 13:00 KST 트리거)
//
//  설정 방법:
//  1. GAS 에디터 왼쪽 메뉴 "트리거" 클릭
//  2. "트리거 추가" → 함수: checkAndSendDailyAlert
//  3. 이벤트 소스: 시간 기반
//  4. 시간 유형: 매일 오전/오후 중 "오전 4시~5시" 선택 (UTC 04:00 = KST 13:00)
//  5. 저장
//
//  수신자 설정: 아래 RECIPIENTS 객체에 법인별 이메일 입력
// ══════════════════════════════════════════════════════════════════════

// ── 법인별 수신자 설정 ────────────────────────────────────────────────
// 복수 수신자: 쉼표로 구분 (예: 'email1@co.com, email2@co.com')
const RECIPIENTS = {
  '셀바스에이아이': 'selvasai1@example.com, selvasai2@example.com',    // ← 실제 이메일로 변경
  '셀바스헬스케어': 'selvashc1@example.com, selvashc2@example.com',    // ← 실제 이메일로 변경
  '메디아나':       'mediana1@example.com, mediana2@example.com',      // ← 실제 이메일로 변경
};

// ── Supabase 설정 ────────────────────────────────────────────────────
const SB_URL = 'https://qobfmihxcclbzfaohnor.supabase.co';
const SB_KEY = PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY');

// ── 한국 공휴일 (2025~2027) ──────────────────────────────────────────
const KR_HOLIDAYS = new Set([
  '2025-01-01','2025-01-28','2025-01-29','2025-01-30',
  '2025-03-01','2025-05-05','2025-05-06','2025-06-06',
  '2025-08-15','2025-10-03','2025-10-05','2025-10-06','2025-10-07','2025-10-09',
  '2025-12-25',
  '2026-01-01','2026-01-28','2026-01-29','2026-01-30',
  '2026-03-01','2026-03-02','2026-05-05','2026-06-06',
  '2026-08-17','2026-09-24','2026-09-25','2026-09-26',
  '2026-10-03','2026-10-05','2026-10-09','2026-12-25',
  '2027-01-01','2027-01-15','2027-01-16','2027-01-17',
  '2027-03-01','2027-05-05','2027-06-06',
  '2027-08-16','2027-10-03','2027-10-04','2027-10-05','2027-10-06','2027-10-09',
  '2027-12-25',
]);

// ── 진단 함수 — GAS 에디터에서 직접 실행해 401 원인을 가린다 ─────────
// 키 자체는 로그에 남기지 않는다(길이·앞 12자·JWT payload 만).
function debugSupabaseKey() {
  var raw = PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY');
  if (!raw) { Logger.log('SUPABASE_KEY 속성이 없습니다 — 스크립트 속성에 추가하세요.'); return; }
  var key = raw.trim();

  Logger.log('길이=' + raw.length + ' (정상 anon 키는 208자) / 앞12자=' + key.slice(0, 12)
    + ' / 뒤6자=' + key.slice(-6));
  Logger.log('앞뒤 공백·줄바꿈: ' + ((raw !== key) ? '있음 ← 401 원인일 수 있음' : '없음'));

  // 가장 흔한 실수 — 대시보드에 축약 표시된 'eyJhbGci...' 를 그대로 붙여넣는 경우.
  // 화면 텍스트를 드래그 복사하면 말줄임표까지 들어와 10~20자짜리 값이 저장된다.
  if (key.length < 100) {
    Logger.log('⚠ 키가 잘렸습니다 — 화면에 축약 표시된 문자열을 복사한 것으로 보입니다.');
    Logger.log('  Supabase 대시보드에서 반드시 **복사 버튼**으로 전체 값을 가져오세요(208자).');
  }

  var parts = key.split('.');
  if (parts.length === 3) {
    try {
      var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString();
      var pl = JSON.parse(json);
      Logger.log('JWT role=' + pl.role + ' / ref=' + pl.ref + ' / 만료=' + new Date(pl.exp * 1000));
      Logger.log('  → role 은 anon, ref 는 qobfmihxcclbzfaohnor 여야 합니다.');
    } catch (e) { Logger.log('JWT payload 파싱 실패: ' + e); }
  } else {
    Logger.log('JWT 형식이 아닙니다 — sb_publishable_… / sb_secret_… 같은 신형 키는');
    Logger.log('  이 프로젝트에서 401 이 납니다. Legacy API keys 의 anon public(eyJ… 로 시작)을 쓰세요.');
  }

  var kstToday = Utilities.formatDate(new Date(new Date().getTime() + 9 * 3600 * 1000), 'UTC', 'yyyy-MM-dd');
  var calls = [
    { label: '테이블 직접 조회(RLS로 막히는 게 정상)', path: '/rest/v1/daily?select=company&limit=1', method: 'get' },
    { label: 'RPC daily_input_companies(정상 경로)',   path: '/rest/v1/rpc/daily_input_companies', method: 'post' },
  ];
  for (var i = 0; i < calls.length; i++) {
    var c = calls[i];
    var opt = {
      method: c.method,
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
      muteHttpExceptions: true,
      timeout: 10000,
    };
    if (c.method === 'post') {
      opt.contentType = 'application/json';
      opt.payload = JSON.stringify({ p_date: kstToday });
    }
    var r = UrlFetchApp.fetch(SB_URL + c.path, opt);
    Logger.log(c.label + ' → HTTP ' + r.getResponseCode() + ' / ' + r.getContentText().slice(0, 200));
  }
  Logger.log('판정: 둘 다 401 → 키 문제 / 앞은 200 [] 이고 RPC 가 404 → SQL 미실행 / RPC 200 + 목록 → 정상');
}

// ── 메인 함수 (트리거로 실행) ─────────────────────────────────────────
function checkAndSendDailyAlert() {
  try {
    // 1. 오늘 날짜 (KST = UTC+9)
    const now     = new Date();
    const kstNow  = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today   = Utilities.formatDate(kstNow, 'UTC', 'yyyy-MM-dd');
    const todayDisp = Utilities.formatDate(kstNow, 'UTC', 'yyyy년 MM월 dd일');

    Logger.log('=== 운전자금 미입력 체크: ' + today + ' ===');

    // 2. 영업일 체크
    const dow = kstNow.getDay(); // 0=일, 6=토
    if (dow === 0 || dow === 6) {
      Logger.log('주말 — 발송 생략');
      return;
    }
    if (KR_HOLIDAYS.has(today)) {
      Logger.log('공휴일(' + today + ') — 발송 생략');
      return;
    }

    // 3. 중복 발송 방지 (오늘 이미 발송했으면 생략)
    const props      = PropertiesService.getScriptProperties();
    const lastSentKey = 'daily_alert_sent_' + today;
    if (props.getProperty(lastSentKey) === '1') {
      Logger.log('오늘 이미 발송됨 — 생략');
      return;
    }

    // 4. Supabase에서 오늘 입력된 법인 목록 조회
    // .trim() — 복붙 과정에서 앞뒤 공백·줄바꿈이 섞이면 헤더가 깨져 401 이 난다
    const sbKey = (props.getProperty('SUPABASE_KEY') || SB_KEY || '').trim();
    if (!sbKey) {
      Logger.log('SUPABASE_KEY 없음 — 종료');
      return;
    }

    // ⚠ 2026-08-26 RLS 전환 이후 daily 테이블은 anon 으로 직접 조회할 수 없다.
    //   (오류가 아니라 200 [] 가 돌아와 '전 법인 미입력'으로 오판 → 오탐 메일)
    //   그래서 SECURITY DEFINER 함수로 그날 입력된 법인명만 받아온다.
    //   선행: docs/db/gas_daily_input_status_rpc.sql 실행 + 스크립트 속성 SUPABASE_KEY 를
    //        **현재 유효한 anon 키**로 갱신(옛 키는 401 Invalid API key).
    const url  = SB_URL + '/rest/v1/rpc/daily_input_companies';
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ p_date: today }),
      headers: {
        'apikey':        sbKey,
        'Authorization': 'Bearer ' + sbKey,
      },
      muteHttpExceptions: true,
      timeout: 10000,
    });

    if (resp.getResponseCode() !== 200) {
      // 실패 시 절대 발송하지 않는다 — 조회 실패를 '미입력'으로 오해하면 전 법인 오탐.
      Logger.log('Supabase 조회 실패: HTTP ' + resp.getResponseCode()
        + ' / ' + resp.getContentText().slice(0, 200));
      return;
    }

    const rows           = JSON.parse(resp.getContentText()) || [];
    const inputCompanies = new Set(rows.map(function (r) { return r.company; }));

    Logger.log('오늘 입력 완료 법인: ' + JSON.stringify([...inputCompanies]));

    // 5. 미입력 법인에 메일 발송
    let sentCount = 0;
    for (const [company, email] of Object.entries(RECIPIENTS)) {
      if (inputCompanies.has(company)) {
        Logger.log('[' + company + '] 입력 완료 — 발송 생략');
        continue;
      }

      // 수신자 이메일 유효성 간단 체크
      // 쉼표로 구분된 복수 이메일 중 하나라도 example.com이면 미설정으로 판단
      const emailList = email ? email.split(',').map(e => e.trim()).filter(e => e) : [];
      if (!emailList.length || emailList.every(e => !e.includes('@') || e.includes('example.com'))) {
        Logger.log('[' + company + '] 수신자 미설정 — 발송 생략');
        continue;
      }

      const subject = '[Selvas Treasury] ' + company + ' 운전자금 미입력 알림 (' + todayDisp + ')';
      const body = [
        todayDisp + ' 운전자금이 아직 입력되지 않았습니다.',
        '',
        '■ 법인: ' + company,
        '■ 기준일: ' + today,
        '■ 확인 시각: 13:00 KST',
        '',
        '아래 링크에서 운전자금을 입력해 주세요.',
        'https://treasury.selvas.com',
        '',
        '─────────────────────────────────',
        '본 메일은 Selvas Treasury 시스템에서 자동 발송됩니다.',
        '입력이 완료된 경우 이 메일을 무시해 주세요.',
      ].join('\n');

      try {
        MailApp.sendEmail({
          to:      emailList.join(', '),  // 복수 수신자
          from:    'matthew.y.jeong@selvas.com',  // Gmail에 등록된 발신 주소
          name:    'Selvas Treasury',              // 발신자 표시 이름
          subject: subject,
          body:    body,
        });
        Logger.log('[' + company + '] 발송 완료 → ' + emailList.join(', '));
        sentCount++;
      } catch (mailErr) {
        Logger.log('[' + company + '] 메일 발송 실패: ' + mailErr.toString());
      }
    }

    // 6. 발송 여부 기록 (오늘 하루만 유효)
    if (sentCount > 0) {
      props.setProperty(lastSentKey, '1');
      Logger.log('총 ' + sentCount + '건 발송 완료. 오늘 재발송 방지 설정.');
    } else {
      Logger.log('발송 대상 없음 (전 법인 입력 완료 또는 수신자 미설정)');
    }

  } catch (err) {
    Logger.log('checkAndSendDailyAlert ERROR: ' + err.toString());
  }
}

// ── 테스트 함수 (실제 발송 전 확인용) ───────────────────────────────
function testDailyAlert() {
  Logger.log('=== 메일 발송 테스트 (실제 발송 없음) ===');
  const props  = PropertiesService.getScriptProperties();
  const sbKey  = props.getProperty('SUPABASE_KEY');

  if (!sbKey) {
    Logger.log('⚠ SUPABASE_KEY를 스크립트 속성에 추가해주세요');
    return;
  }

  // 수신자 설정 확인
  for (const [co, email] of Object.entries(RECIPIENTS)) {
    if (email.includes('example.com')) {
      const testList = email.split(',').map(e=>e.trim());
      testList.forEach(e => Logger.log('⚠ [' + co + '] 실제 주소로 변경 필요: ' + e));
    } else {
      const okList = email.split(',').map(e=>e.trim());
      Logger.log('✓ [' + co + '] 수신자 ' + okList.length + '명: ' + okList.join(', '));
    }
  }

  Logger.log('\n설정이 완료되면 checkAndSendDailyAlert() 를 직접 실행해서 테스트하세요.');
  Logger.log('트리거 설정: 매일 오전 4시~5시 (KST 13시~14시)');
}


// ══════════════════════════════════════════════════════════════════════
//  자금일보 결재 요청 메일 (상신·승인 즉시 + 주기 스윕 보완)
//
//  흐름
//    자금일보 화면에서 상신/승인 성공 → ?type=approvalnotify&reportId=... 호출
//      → 서버(GAS)가 DB에서 '지금 차례인 결재자'를 찾아 메일 발송
//    누락 대비: sweepApprovalNotifications() 를 30분 주기 트리거로 함께 돌린다
//      (브라우저가 닫히거나 네트워크가 끊겨 호출이 유실된 경우를 줍는다)
//
//  중복 발송은 DB의 unique(report_id, step)이 막는다 — 두 경로를 같이 켜도 안전하다.
//
//  선행:
//    1) docs/db/approval_notification.sql 실행
//    2) 스크립트 속성 NOTIFY_TOKEN = 위 SQL 이 출력한 토큰
//    3) SUPABASE_KEY = 현재 anon 키(208자)
// ══════════════════════════════════════════════════════════════════════

const APP_URL = 'https://treasury.selvas.com';

/** Supabase RPC 호출 (anon 키 + 토큰) */
function callNotifyRpc_(fnName, args) {
  var props = PropertiesService.getScriptProperties();
  var sbKey = (props.getProperty('SUPABASE_KEY') || '').trim();
  var token = (props.getProperty('NOTIFY_TOKEN') || '').trim();
  if (!sbKey) throw new Error('SUPABASE_KEY 미설정');
  if (!token) throw new Error('NOTIFY_TOKEN 미설정 — approval_notification.sql 실행 후 출력된 토큰을 넣으세요');

  args.p_token = token;
  var resp = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/' + fnName, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(args),
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey },
    muteHttpExceptions: true,
    timeout: 10000,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error(fnName + ' HTTP ' + resp.getResponseCode() + ' / ' + resp.getContentText().slice(0, 200));
  }
  return JSON.parse(resp.getContentText());
}

/**
 * 알림 대상 1건 발송.
 * ⚠ 반드시 record → send 순서. 먼저 기록해 중복을 막는다.
 *   (보내고 기록하면, 기록 실패 시 같은 메일이 계속 재발송된다)
 * @return 'sent' | 'skipped' | 'failed'
 */
function sendOneApprovalMail_(row) {
  var recipients = String(row.approver_email || '').trim();
  if (!recipients) return 'skipped';

  // 선점(중복 방지). false = 다른 경로가 이미 보냄 → 조용히 건너뛴다.
  var claimed = callNotifyRpc_('record_approval_notification', {
    p_report_id: row.report_id, p_step: row.step, p_recipients: recipients,
  });
  if (claimed !== true) {
    Logger.log('이미 발송됨 — 건너뜀: ' + row.company + ' ' + row.report_date + ' ' + row.step + '단계');
    return 'skipped';
  }

  var dateStr  = String(row.report_date || '').slice(0, 10);
  var submitter = row.submitter_name || row.submitted_by || '담당자';
  var subject = '[Selvas Treasury] 결재 요청 — ' + row.company + ' ' + dateStr + ' 자금일보';
  var body = [
    (row.approver_name || '') + '님, 결재하실 자금일보가 있습니다.',
    '',
    '■ 법인: ' + row.company,
    '■ 작성일: ' + dateStr,
    '■ 결재 단계: ' + row.step + '단계 (' + (row.role_label || '') + ')',
    '■ 상신자: ' + submitter,
    '',
    '아래 링크에서 내용을 확인하고 승인 또는 반려해 주세요.',
    APP_URL + '/daily-report/' + encodeURIComponent(row.company) + '/' + dateStr,
    '',
    '─────────────────────────────────',
    '본 메일은 Selvas Treasury 시스템에서 자동 발송됩니다.',
  ].join('\n');

  try {
    MailApp.sendEmail({
      to: recipients,
      from: 'matthew.y.jeong@selvas.com',
      name: 'Selvas Treasury',
      subject: subject,
      body: body,
    });
    Logger.log('발송 완료 → ' + recipients + ' (' + row.company + ' ' + dateStr + ' ' + row.step + '단계)');
    return 'sent';
  } catch (mailErr) {
    // 기록은 남았는데 발송만 실패한 경우 — 로그로 남기고 수동 확인한다.
    // (기록을 지우면 무한 재시도가 될 수 있어 자동 롤백하지 않는다)
    Logger.log('메일 발송 실패(기록은 남음): ' + mailErr.toString());
    return 'failed';
  }
}

/** 웹앱 진입점 — 화면이 상신·승인 직후 호출 */
function sendApprovalNotify_(e) {
  var reportId = (e.parameter.reportId || '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(reportId)) {
    return createResponse({ success: false, error: 'reportId(uuid) 필요' }, 400);
  }
  try {
    var rows = callNotifyRpc_('approval_notifications_pending', { p_report_id: reportId });
    if (!rows.length) {
      // 결재 완료·반려·이미 발송 등 — 정상 상황이다.
      return createResponse({ success: true, sent: 0, reason: '발송 대상 없음' });
    }
    var sent = 0;
    for (var i = 0; i < rows.length; i++) {
      if (sendOneApprovalMail_(rows[i]) === 'sent') sent++;
    }
    return createResponse({ success: true, sent: sent });
  } catch (err) {
    Logger.log('sendApprovalNotify_ ERROR: ' + err.toString());
    return createResponse({ success: false, error: err.toString().slice(0, 200) }, 500);
  }
}

/**
 * 누락 보완용 스윕 — 30분 주기 트리거로 등록할 것.
 * 화면 호출이 유실된 건(브라우저 종료·네트워크 끊김)을 뒤늦게라도 발송한다.
 */
function sweepApprovalNotifications() {
  try {
    var rows = callNotifyRpc_('approval_notifications_pending', {});
    Logger.log('=== 결재 알림 스윕: 대상 ' + rows.length + '건 ===');
    var sent = 0;
    for (var i = 0; i < rows.length; i++) {
      if (sendOneApprovalMail_(rows[i]) === 'sent') sent++;
    }
    Logger.log('발송 ' + sent + '건');
  } catch (err) {
    Logger.log('sweepApprovalNotifications ERROR: ' + err.toString());
  }
}

/**
 * 진단 — 실제 발송 없이 현재 알림 대상만 확인.
 *
 * ⚠ 토큰이 틀리면 approval_notifications_pending 은 오류가 아니라 **빈 배열**을 돌려준다.
 *   그러면 "발송 대상 없음"과 구별이 안 되므로, 토큰 유효성부터 따로 확인한다.
 */
function testApprovalNotify() {
  var props = PropertiesService.getScriptProperties();
  var sbKey = (props.getProperty('SUPABASE_KEY') || '').trim();
  var token = (props.getProperty('NOTIFY_TOKEN') || '').trim();

  Logger.log('=== 결재 알림 진단 ===');
  Logger.log('SUPABASE_KEY: ' + (sbKey ? '설정됨(' + sbKey.length + '자)' : '⚠ 없음'));
  Logger.log('NOTIFY_TOKEN: ' + (token ? '설정됨(' + token.length + '자, 앞6자=' + token.slice(0, 6) + ')' : '⚠ 없음'));
  if (!sbKey || !token) {
    Logger.log('→ 스크립트 속성을 먼저 채우세요.');
    return;
  }
  if (token.length !== 48) {
    Logger.log('⚠ 토큰 길이가 48자가 아닙니다 — approval_notification.sql 이 출력한 값 전체를 넣었는지 확인하세요.');
  }

  // 1) 토큰이 DB 값과 일치하는가
  try {
    var ok = callNotifyRpc_('check_notify_token', {});
    Logger.log('토큰 검증: ' + (ok === true ? '✅ 일치' : '❌ 불일치 — DB의 app_secrets 값과 다릅니다'));
    if (ok !== true) {
      Logger.log('  Supabase 에서 확인: select value from app_secrets where name = ' + String.fromCharCode(39) + 'gas_notify_token' + String.fromCharCode(39) + ';');
      return;
    }
  } catch (err) {
    Logger.log('토큰 검증 실패: ' + err.toString());
    return;
  }

  // 2) 발송 대기 목록
  try {
    var rows = callNotifyRpc_('approval_notifications_pending', {});
    Logger.log('발송 대기 ' + rows.length + '건');
    rows.forEach(function (r) {
      Logger.log('· ' + r.company + ' ' + String(r.report_date).slice(0, 10)
        + ' / ' + r.step + '단계 ' + (r.role_label || '')
        + ' → ' + (r.approver_name || '?') + ' <' + (r.approver_email || '없음') + '>');
    });
    if (!rows.length) {
      Logger.log('0건입니다. 토큰은 정상이므로 아래 중 하나입니다:');
      Logger.log('  · 결재 중(submitted) 상태인 자금일보가 없다');
      Logger.log('    — 상신자가 유일한 결재자면 상신과 동시에 승인 완료되어 대상이 없다');
      Logger.log('  · 그 단계에 대해 이미 발송했다 (approval_notifications 에 기록됨)');
      Logger.log('  · 결재선의 결재자 코드가 treasury_users.user_code 와 매칭되지 않거나');
      Logger.log('    그 계정에 이메일이 비어 있다 → 조직도 관리·사용자 관리에서 확인');
    }
  } catch (err) {
    Logger.log('조회 실패: ' + err.toString());
  }
}


// ══════════════════════════════════════════════════════════════════════
//  FX 표준편차 자동계산 — 한국은행 ECOS API
//
//  스크립트 속성에 ECOS_API_KEY 필요:
//    GAS 에디터 → 프로젝트 설정 → 스크립트 속성 → ECOS_API_KEY 추가
//    발급: https://ecos.bok.or.kr/api/#/ (무료 회원가입 후 즉시 발급)
//
//  호출: ?type=fxstddev
//  옵션: ?type=fxstddev&months=12  (기간, 기본 12개월)
//
//  응답:
//  {
//    "success": true,
//    "period": { "from": "20250101", "to": "20260101" },
//    "dataCount": 252,
//    "stddev": {
//      "USD": 0.082458,
//      "EUR": 0.114437,
//      "JPY": 0.108875,
//      "GBP": 0.130257
//    },
//    "source": "ecos.bok.or.kr"
//  }
// ══════════════════════════════════════════════════════════════════════

// ECOS 통화코드 매핑 (731Y001 StatisticItemList 확인값)
const ECOS_CURRENCY_CODES = {
  USD: '0000001',  // 원/미국달러(매매기준율)
  EUR: '0000003',  // 원/유로
  JPY: '0000002',  // 원/일본엔(100엔)
  GBP: '0000012',  // 원/영국파운드 ← 0000004는 독일마르크(폐지)
};

function calcFxStdDevFromEcos_(e) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ECOS_API_KEY');
  if (!apiKey) {
    return createResponse({
      success: false,
      error: 'ECOS_API_KEY가 설정되지 않았습니다. GAS 스크립트 속성에 ECOS_API_KEY를 추가하세요.',
      guide: 'https://ecos.bok.or.kr/api/#/'
    }, 503);
  }

  // 기간 계산 (기본 12개월)
  const months = parseInt(e.parameter.months || '12', 10);
  const today = new Date();
  const from  = new Date(today);
  from.setMonth(from.getMonth() - months);

  // 당일 데이터는 아직 게재되지 않는 경우가 많아 전일 기준으로 조회
  // (기존엔 주석으로만 의도가 남아있고 실제 반영이 안 돼 있었음 — 세션20차 수정)
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const toStr   = formatDateEcos_(yesterday);
  const fromStr = formatDateEcos_(from);

  Logger.log('ECOS FX 표준편차 계산: ' + fromStr + ' ~ ' + toStr);

  const stddevMap = {};
  const errorDetails = {};   // 통화별 실패 사유 — 웹앱 응답에 그대로 실어 클라이언트 화면에 노출
  let minDataCount = Infinity;

  for (const [currency, code] of Object.entries(ECOS_CURRENCY_CODES)) {
    Utilities.sleep(300); // ECOS rate limit 방지 (3분 300회 한도)
    try {
      // fetchEcosRates_ 는 { date, rate } 배열을 반환 — 표준편차 계산은 값만 필요
      const prices = fetchEcosRates_(apiKey, code, fromStr, toStr)
        .map(function(r) { return r.rate; });
      if (!prices || prices.length < 10) {
        const msg = '데이터 부족 (' + (prices ? prices.length : 0) + '건)';
        Logger.log(currency + ': ' + msg);
        stddevMap[currency] = null;
        errorDetails[currency] = msg;
        continue;
      }
      // 일별 수익률 계산: (오늘 - 전일) / 전일
      const returns = [];
      for (let i = 1; i < prices.length; i++) {
        if (prices[i - 1] > 0) {
          returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }
      }
      const dailyStd = calcStdDev_(returns);
      // 연간 표준편차 = 일별 표준편차 × √(연간 영업일 수)
      // 금융 표준: 연간 252 영업일 기준 annualization
      const annualStd = dailyStd * Math.sqrt(252);
      stddevMap[currency] = parseFloat(annualStd.toFixed(6));
      minDataCount = Math.min(minDataCount, prices.length);
      Logger.log(currency + ': ' + prices.length + '건, 일별=' + dailyStd.toFixed(6) +
                 ', 연환산=' + annualStd.toFixed(6));
    } catch (err) {
      // err.toString()에 UrlFetchApp의 원본 예외 메시지(요청 URL 그대로 포함 — API 키 노출)가
      // 담길 수 있어, 클라이언트로 내려가기 전에 반드시 키를 마스킹한다.
      const msg = err.toString().split(apiKey).join('***');
      Logger.log(currency + ' 오류: ' + msg);
      stddevMap[currency] = null;
      errorDetails[currency] = msg;
    }
  }

  const hasData = Object.values(stddevMap).some(v => v !== null);
  if (!hasData) {
    return createResponse({
      success: false,
      error: 'ECOS에서 환율 데이터를 가져오지 못했습니다. API 키 또는 네트워크를 확인하세요.',
      details: errorDetails   // 예: { USD: "ECOS 오류: ERROR-602 ...", EUR: "ECOS HTTP 403", ... }
    }, 503);
  }

  return createResponse({
    success: true,
    period: { from: fromStr, to: toStr },
    dataCount: minDataCount === Infinity ? 0 : minDataCount,
    stddev: stddevMap,
    source: 'ecos.bok.or.kr'
  }, 200);
}

/**
 * ECOS API에서 특정 통화의 일별 환율 배열 반환
 *
 * 731Y001 통계는 1차원 구조 — ITEM_CODE 하나만 사용 (ITEM_CODE2 없음)
 * URL: .../731Y001/DD/{from}/{to}/{itemCode}
 *
 * itemCode는 ECOS_CURRENCY_CODES 맵에서 관리
 * (testEcosItemList 로 전체 53개 코드 확인 후 업데이트)
 */
function fetchEcosRates_(apiKey, itemCode, fromDate, toDate) {
  // toDate는 호출부(calcFxStdDevFromEcos_)에서 이미 전일로 보정해 전달함
  // 주기 코드: 일별 = 'D' (명세서 확인: 년A/반년S/분기Q/월M/반월SM/일D)
  const url = [
    'https://ecos.bok.or.kr/api/StatisticSearch',
    apiKey, 'json', 'kr', '1', '500',
    '731Y001', 'D',
    fromDate, toDate,
    itemCode
  ].join('/');

  Logger.log('ECOS 요청: ' + url.replace(apiKey, 'API_KEY'));

  let resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'GET',
      muteHttpExceptions: true,
      headers: { 'Accept': 'application/json' }
    });
  } catch (fetchErr) {
    // UrlFetchApp이 던지는 원본 예외는 요청 URL(=API 키 포함)을 그대로 담고 있어
    // 호출부까지 그대로 전파하면 클라이언트 응답(errorDetails)에 키가 노출된다.
    // 여기서 즉시 키를 제거한 안전한 메시지로 치환해 던진다.
    throw new Error('ECOS 요청 실패(네트워크): ' + fetchErr.toString().split(apiKey).join('***'));
  }

  const code = resp.getResponseCode();
  if (code !== 200) throw new Error('ECOS HTTP ' + code);

  const json = JSON.parse(resp.getContentText('UTF-8'));

  if (json.RESULT) {
    const ec = json.RESULT.CODE || '';
    const em = json.RESULT.MESSAGE || '';
    if (ec === 'ERROR-602') throw new Error('ECOS rate limit: 30분 후 재시도');
    throw new Error('ECOS 오류: ' + ec + ' ' + em);
  }

  const rows = (json.StatisticSearch || {}).row || [];
  // ⚠ 과거엔 값(DATA_VALUE)만 반환하고 TIME(날짜)을 버렸다.
  //   표준편차 계산에는 날짜가 불필요해 문제가 없었으나, 시계열 저장(fx_rate_history)에는
  //   날짜가 필수이므로 { date: 'YYYY-MM-DD', rate: number } 형태로 반환하도록 변경.
  //   → 숫자 배열이 필요한 호출부는 .map(r => r.rate) 로 변환해 사용할 것.
  return rows
    .map(function(r) {
      const t = String(r.TIME || '');            // ECOS 일별 TIME 형식: YYYYMMDD
      const v = parseFloat(r.DATA_VALUE);
      if (t.length !== 8 || isNaN(v) || v <= 0) return null;
      return {
        date: t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8),
        rate: v
      };
    })
    .filter(function(x) { return x !== null; });
}

// ══════════════════════════════════════════════════════════════════════
//  FX 일별 환율 이력 조회 — 한국은행 ECOS API (환율 국면 판정용 시계열)
//
//  호출: ?type=fxhistory&currency=USD&from=YYYYMMDD&to=YYYYMMDD
//    currency : USD | EUR | JPY | GBP  (ECOS_CURRENCY_CODES 키)
//    from/to  : 생략 시 최근 1년
//
//  ⚠ ECOS는 1회 요청당 최대 500건을 반환한다. 일별 데이터는 연 약 250건이므로
//    호출부(클라이언트)가 반드시 **연 단위로 쪼개어** 호출해야 한다.
//    한 번에 2년을 초과해 요청하면 뒷 구간이 조용히 잘린다 → truncated: true 로 경고한다.
//
//  ⚠ JPY는 ECOS 기준 "원/100엔"이다. 저장·표시 시 단위 변환에 주의할 것.
//
//  응답:
//  {
//    "success": true,
//    "currency": "USD",
//    "from": "20250101", "to": "20251231",
//    "count": 248,
//    "truncated": false,
//    "rates": [ { "date": "2025-01-02", "rate": 1472.5 }, ... ],
//    "source": "ecos.bok.or.kr"
//  }
// ══════════════════════════════════════════════════════════════════════
function fetchFxHistoryFromEcos_(e) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ECOS_API_KEY');
  if (!apiKey) {
    return createResponse({
      success: false,
      error: 'ECOS_API_KEY가 설정되지 않았습니다. GAS 스크립트 속성에 ECOS_API_KEY를 추가하세요.',
      guide: 'https://ecos.bok.or.kr/api/#/'
    }, 503);
  }

  const currency = (e.parameter.currency || 'USD').trim().toUpperCase();
  const code = ECOS_CURRENCY_CODES[currency];
  if (!code) {
    return createResponse({
      success: false,
      error: '지원하지 않는 통화: ' + currency,
      supported: Object.keys(ECOS_CURRENCY_CODES)
    }, 400);
  }

  // 기본 구간: 최근 1년 (당일은 미게재인 경우가 많아 전일까지)
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const defFrom = new Date(yesterday);
  defFrom.setFullYear(defFrom.getFullYear() - 1);

  const toStr   = (e.parameter.to   || '').trim() || formatDateEcos_(yesterday);
  const fromStr = (e.parameter.from || '').trim() || formatDateEcos_(defFrom);

  if (!/^\d{8}$/.test(fromStr) || !/^\d{8}$/.test(toStr)) {
    return createResponse({ success: false, error: 'from/to 는 YYYYMMDD 형식이어야 합니다.' }, 400);
  }

  Logger.log('ECOS 환율 이력: ' + currency + ' ' + fromStr + ' ~ ' + toStr);

  try {
    const rates = fetchEcosRates_(apiKey, code, fromStr, toStr);
    return createResponse({
      success:   true,
      currency:  currency,
      from:      fromStr,
      to:        toStr,
      count:     rates.length,
      // 500건은 ECOS 페이지 상한 = 잘렸을 가능성이 높다는 신호
      truncated: rates.length >= 500,
      rates:     rates,
      source:    'ecos.bok.or.kr'
    });
  } catch (err) {
    // fetchEcosRates_ 내부에서 API 키는 이미 마스킹되어 던져진다
    return createResponse({
      success:  false,
      currency: currency,
      error:    err.toString()
    }, 502);
  }
}

/**
 * GAS 에디터에서 직접 실행하여 환율 이력 조회 테스트
 */
function testFxHistory() {
  const res = fetchFxHistoryFromEcos_({ parameter: { currency: 'USD' } });
  const json = JSON.parse(res.getContent());
  Logger.log('success: ' + json.success + ' / count: ' + json.count + ' / truncated: ' + json.truncated);
  if (json.rates && json.rates.length) {
    Logger.log('첫 건: ' + JSON.stringify(json.rates[0]));
    Logger.log('끝 건: ' + JSON.stringify(json.rates[json.rates.length - 1]));
  } else {
    Logger.log('오류: ' + json.error);
  }
}

/**
 * 진단용: 731Y001 통계의 실제 항목 코드 목록 출력
 * GAS 에디터에서 직접 실행 → 로그에서 ITEM_CODE1/2 확인
 */
function testEcosItemList() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ECOS_API_KEY');
  if (!apiKey) { Logger.log('ECOS_API_KEY 미설정'); return; }

  const url = 'https://ecos.bok.or.kr/api/StatisticItemList/' +
    apiKey + '/json/kr/1/200/731Y001';
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: {'Accept': 'application/json'} });
  Logger.log('HTTP: ' + resp.getResponseCode());

  const text = resp.getContentText('UTF-8');
  const json = JSON.parse(text);

  // 최상위 키 확인
  Logger.log('응답 최상위 키: ' + Object.keys(json).join(', '));

  const topKey = Object.keys(json)[0];
  const rows = (json[topKey] || {}).row || [];
  // 전체 53개 항목 출력 — EUR/GBP 코드 확인용
  rows.forEach(function(r, i) {
    Logger.log(i + ': ITEM_CODE=' + r.ITEM_CODE + ' | ' + r.ITEM_NAME + ' | 데이터수=' + r.DATA_CNT);
  });
  Logger.log('총 ' + rows.length + '개 항목');
}

/**
 * 한국 법정공휴일 조회 — 공공데이터포털 한국천문연구원_특일정보 API
 *
 * 스크립트 속성 필요: HOLIDAY_API_KEY (공공데이터포털 인증키, 디코딩된 키 사용)
 * 발급: https://www.data.go.kr → 한국천문연구원_특일정보 검색 → 활용신청
 *
 * GET ?type=holidays&year=2027
 * → { success:true, year:2027, dates:["2027-01-01","2027-02-17",...] }
 */
function fetchKoreanHolidays_(e) {
  const year = parseInt(e.parameter.year || new Date().getFullYear(), 10);
  if (isNaN(year) || year < 2020 || year > 2035) {
    return createResponse({ success: false, error: '유효하지 않은 연도입니다.' }, 400);
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty('HOLIDAY_API_KEY');
    if (!apiKey) {
      return createResponse({ success: false, error: 'HOLIDAY_API_KEY 스크립트 속성이 없습니다.' }, 500);
    }

    const url = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getHoliDeInfo'
      + '?serviceKey=' + encodeURIComponent(apiKey)
      + '&solYear=' + year
      + '&numOfRows=50'
      + '&_type=json';

    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      deadline: 20
    });
    if (resp.getResponseCode() !== 200) {
      return createResponse({ success: false, error: 'API HTTP ' + resp.getResponseCode() }, 502);
    }

    const json = JSON.parse(resp.getContentText());
    const items = json.response?.body?.items?.item;
    if (!items) {
      return createResponse({ success: false, error: '데이터 없음' }, 404);
    }

    const list = Array.isArray(items) ? items : [items];
    const dates = list
      .filter(function(item) { return item.isHoliday === 'Y'; })
      .map(function(item) {
        const d = String(item.locdate);
        return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
      });

    return createResponse({ success: true, year: year, dates: dates, source: 'data.go.kr/astro' }, 200);

  } catch (err) {
    return createResponse({ success: false, error: err.toString().slice(0, 150) }, 500);
  }
}

/**
 * 공휴일 API 테스트 — GAS 에디터에서 직접 실행
 * 실행 후 로그(Ctrl+Enter)에서 결과 확인
 */
function testHolidays2026() {
  const e = { parameter: { type: 'holidays', year: '2026' } };
  const result = fetchKoreanHolidays_(e);
  const json = JSON.parse(result.getContent());
  Logger.log('=== 2026 공휴일 ===');
  Logger.log('성공: ' + json.success);
  if (json.success) {
    Logger.log('건수: ' + json.dates.length);
    json.dates.forEach(function(d) { Logger.log(d); });
  } else {
    Logger.log('오류: ' + json.error);
  }
}

function testHolidays2027() {
  const e = { parameter: { type: 'holidays', year: '2027' } };
  const result = fetchKoreanHolidays_(e);
  const json = JSON.parse(result.getContent());
  Logger.log('=== 2027 공휴일 ===');
  Logger.log('성공: ' + json.success);
  if (json.success) {
    Logger.log('건수: ' + json.dates.length);
    json.dates.forEach(function(d) { Logger.log(d); });
  } else {
    Logger.log('오류: ' + json.error);
  }
}

function testHolidays2028() {
  const e = { parameter: { type: 'holidays', year: '2028' } };
  const result = fetchKoreanHolidays_(e);
  const json = JSON.parse(result.getContent());
  Logger.log('=== 2028 공휴일 ===');
  Logger.log('성공: ' + json.success);
  if (json.success) {
    Logger.log('건수: ' + json.dates.length);
    json.dates.forEach(function(d) { Logger.log(d); });
  } else {
    Logger.log('오류: ' + json.error);
  }
}

/** 표본 표준편차 계산 */
function calcStdDev_(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
  return Math.sqrt(variance);
}

/** 날짜 → YYYYMMDD 문자열 (ECOS 형식) */
function formatDateEcos_(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return '' + y + m + d;
}

/** URL 형식 변형 테스트 — 어떤 형식이 작동하는지 전수조사 */
function testEcosUrlVariants() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ECOS_API_KEY');
  if (!apiKey) { Logger.log('ECOS_API_KEY 미설정'); return; }

  const base = 'https://ecos.bok.or.kr/api/StatisticSearch/' + apiKey;
  const opts = { muteHttpExceptions: true, headers: { 'Accept': 'application/json' } };

  const variants = [
    // A: 핵심 수정 — 주기 'D', USD, 단기범위
    base + '/json/kr/1/10/731Y001/D/20260101/20260401/0000001',
    // B: 주기 'D', EUR
    base + '/json/kr/1/10/731Y001/D/20260101/20260401/0000003',
    // C: 주기 'D', JPY
    base + '/json/kr/1/10/731Y001/D/20260101/20260401/0000002',
    // D: 주기 'D', GBP (0000012)
    base + '/json/kr/1/10/731Y001/D/20260101/20260401/0000012',
    // E: 아이템코드 없이 — 전체 통화 반환 여부 확인
    base + '/json/kr/1/10/731Y001/D/20260101/20260401',
  ];

  variants.forEach(function(url, i) {
    Utilities.sleep(500);
    try {
      const r = UrlFetchApp.fetch(url, opts);
      const text = r.getContentText().slice(0, 120);
      const isError = text.includes('ERROR') || text.includes('error');
      Logger.log('[' + String.fromCharCode(65+i) + '] ' + (isError ? '❌' : '✅') +
                 ' HTTP=' + r.getResponseCode() + ' | ' + text.replace(apiKey, 'KEY'));
    } catch(err) {
      Logger.log('[' + String.fromCharCode(65+i) + '] 예외: ' + err.toString().slice(0,80));
    }
  });
}

/** GAS 에디터에서 직접 실행하여 ECOS API 테스트 */
function testFxStdDev() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ECOS_API_KEY');
  Logger.log('ECOS_API_KEY: ' + (apiKey ? '설정됨 (' + apiKey.slice(0,4) + '...)' : '⚠ 미설정'));

  if (!apiKey) {
    Logger.log('스크립트 속성에 ECOS_API_KEY를 먼저 추가하세요.');
    return;
  }

  const today = new Date();
  const from  = new Date(today);
  from.setMonth(from.getMonth() - 12);
  const toStr   = formatDateEcos_(today);
  const fromStr = formatDateEcos_(from);

  Logger.log('기간: ' + fromStr + ' ~ ' + toStr);
  Logger.log('URL 형식: .../731Y001/D/' + fromStr + '/' + toStr + '/{통화코드}');

  for (const [currency, code] of Object.entries(ECOS_CURRENCY_CODES)) {
    // Rate limit 방지: 통화 간 0.5초 대기
    Utilities.sleep(500);
    try {
      const prices = fetchEcosRates_(apiKey, code, fromStr, toStr)
        .map(function(r) { return r.rate; });
      Logger.log(currency + '(' + code + '): ' + prices.length + '건 조회됨');

      if (prices.length >= 2) {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
          if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }
        const dailyStd  = calcStdDev_(returns);
        const annualStd = dailyStd * Math.sqrt(252);
        Logger.log('  → 일별 표준편차:  ' + dailyStd.toFixed(6)  + ' (' + (dailyStd  * 100).toFixed(4) + '%)');
        Logger.log('  → 연환산 표준편차: ' + annualStd.toFixed(6) + ' (' + (annualStd * 100).toFixed(4) + '%)  ← 저장값');
        Logger.log('  → 최근환율: ' + prices[prices.length - 1]);
      }
    } catch (err) {
      Logger.log(currency + ' 오류: ' + err.toString());
    }
  }
}