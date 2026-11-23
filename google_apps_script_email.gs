/**
 * 3M 클럽 비용 정산기 - 정산서 엑셀/사진 자동 첨부 메일 발송용 Google Apps Script
 *
 * [배포 방법]
 * 1. 발신용 Google 계정(Gochujangs33@gmail.com)으로 https://script.google.com 접속 후 [새 프로젝트] 생성
 * 2. 아래 전체 코드를 붙여넣고 저장(Ctrl+S)
 * 3. 우측 상단 [배포] > [새 배포] > 유형: [웹 앱] 선택
 *    - 다음 사용자 권한으로 실행: 나(Gochujangs33@gmail.com)
 *    - 액세스 권한이 있는 사용자: 모든 사용자
 * 4. [배포] 후 생성된 웹 앱 URL(https://script.google.com/macros/s/.../exec)을 복사하여
 *    정산기 관리자 페이지의 [정산서 엑셀 자동 첨부 메일 설정]에 붙여넣고 저장
 */

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var data = JSON.parse(raw);

    var to = String(data.to || '').trim();
    var subject = String(data.subject || '[클럽 비용 정산] 정산 보고서').trim();
    var body = String(data.body || '').trim();
    var senderName = String(data.senderName || '3M 클럽 비용 정산기').trim();

    if (!to) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Missing recipient email (to)' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var blobs = [];
    if (Array.isArray(data.attachments)) {
      for (var i = 0; i < data.attachments.length; i++) {
        var att = data.attachments[i];
        if (!att || !att.base64 || !att.name) continue;
        var decoded = Utilities.base64Decode(att.base64);
        var mime = att.mimeType || 'application/octet-stream';
        blobs.push(Utilities.newBlob(decoded, mime, att.name));
      }
    }

    GmailApp.sendEmail(to, subject, body, {
      name: senderName,
      attachments: blobs
    });

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, attachmentCount: blobs.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err && err.message ? err.message : err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: '3M Club Expense Mailer' }))
    .setMimeType(ContentService.MimeType.JSON);
}
