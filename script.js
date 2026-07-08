// ============================================================
// 特休假管理系統 - PWA 版前端邏輯
// 透過 fetch() 呼叫 Apps Script 的 doPost API，取代 google.script.run
// ============================================================

// 請把下面這一行換成你自己部署的 Apps Script 網頁應用程式網址（結尾是 /exec）
const API_BASE_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';

async function callApi(action, payload) {
  const res = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 用 text/plain 避開 CORS 預檢請求
    body: JSON.stringify({ action: action, payload: payload || {} })
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '發生未知錯誤');
  return json.data;
}

let CURRENT_EMPLOYEE = null;
let ADMIN_TOKEN = null;
let EMP_TARGET_TAB = 'empTabQuery';
const OTHER_LEAVE_TYPES = ['事假','病假','婚假','喪假','產假'];

function switchMode(mode){
  const isEmp = (mode === 'emp-query' || mode === 'emp-apply');
  document.getElementById('panelEmp').classList.toggle('active', isEmp);
  document.getElementById('panelNewHire').classList.toggle('active', mode==='newhire');
  document.getElementById('panelAdmin').classList.toggle('active', mode==='admin');
  document.getElementById('btnModeEmpQuery').classList.toggle('active', mode==='emp-query');
  document.getElementById('btnModeEmpApply').classList.toggle('active', mode==='emp-apply');
  document.getElementById('btnModeNewHire').classList.toggle('active', mode==='newhire');
  document.getElementById('btnModeAdmin').classList.toggle('active', mode==='admin');
  if(isEmp){
    EMP_TARGET_TAB = (mode === 'emp-apply') ? 'empTabApply' : 'empTabQuery';
    if(CURRENT_EMPLOYEE) switchEmpTab(EMP_TARGET_TAB);
  }
}

function switchEmpTab(tab){
  document.querySelectorAll('#empDashboard .tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('#empDashboard .tab-content').forEach(c=>c.classList.toggle('active', c.id===tab));
}

function showMsg(elId, text, ok){
  const el = document.getElementById(elId);
  const icon = ok ? '✓' : '⚠';
  el.innerHTML = '<div class="msg ' + (ok?'ok':'error') + '">' + icon + ' ' + text + '</div>';
}

/* ---------------- 員工端 ---------------- */
function doFindEmployee(){
  const name = document.getElementById('empName').value.trim();
  const nationalId = document.getElementById('empNationalId').value.trim();
  document.getElementById('empLoginMsg').innerHTML = '';
  callApi('findEmployee', {name: name, nationalId: nationalId})
    .then(function(res){
      if(!res.success){ showMsg('empLoginMsg', res.message, false); return; }
      CURRENT_EMPLOYEE = res.employee;
      renderEmpDashboard(res.employee, res.leave);
      identifyOneSignalEmployee_(res.employee.nationalId);
    })
    .catch(function(err){ showMsg('empLoginMsg', err.message || String(err), false); });
}

function renderEmpDashboard(emp, leave){
  document.getElementById('empDashboard').style.display = 'block';

  let queryHtml = '';
  if(!leave.eligible){
    queryHtml += '<div class="card"><h2>' + emp.name + ' 的特休狀態</h2>' +
            '<p class="hint">' + leave.message + '（預計 ' + leave.nextEligibleDate + ' 起取得特休）</p></div>';
  } else {
    const c = leave.current;
    const pct = c.entitled > 0 ? Math.min(1, c.used / c.entitled) : 0;
    const r = 54, circ = 2*Math.PI*r;
    const dash = circ * pct;

    queryHtml += '<div class="card">';
    queryHtml += '<h2>' + emp.name + ' 的特休狀態　<span style="font-size:12px;color:var(--ink-soft);font-weight:400;">(' + c.label + ')</span></h2>';
    queryHtml += '<div class="ring-wrap">';
    queryHtml += '<svg width="140" height="140" viewBox="0 0 140 140">' +
              '<circle cx="70" cy="70" r="'+r+'" fill="none" stroke="var(--ring-track)" stroke-width="12"/>' +
              '<circle cx="70" cy="70" r="'+r+'" fill="none" stroke="var(--accent)" stroke-width="12" ' +
                'stroke-dasharray="'+dash+' '+circ+'" stroke-linecap="round" ' +
                'transform="rotate(-90 70 70)"/>' +
              '<text x="70" y="66" text-anchor="middle" class="ring-num">' + c.remaining + '</text>' +
              '<text x="70" y="86" text-anchor="middle" class="ring-label">剩餘天數</text>' +
            '</svg>';
    queryHtml += '<div class="stat-grid">';
    queryHtml += statBox('本期特休天數', c.entitled + ' 天');
    queryHtml += statBox('已使用', c.used + ' 天');
    queryHtml += statBox('本期到期日', c.periodEnd);
    queryHtml += statBox('距離到期', leave.daysUntilExpire + ' 天');
    queryHtml += statBox('若到期未休完，預估折抵', 'NT$ ' + leave.forecastPay.toLocaleString(), true);
    queryHtml += '</div></div></div>';
  }

  if(leave.history && leave.history.length){
    queryHtml += '<div class="card"><h2>歷年特休紀錄</h2><div class="table-scroll"><table><thead><tr><th>期別</th><th>期間</th><th>應有天數</th><th>已使用</th><th>到期未休</th><th>已折抵金額</th></tr></thead><tbody>';
    leave.history.forEach(h=>{
      queryHtml += '<tr><td>'+h.label+'</td><td>'+h.periodStart+' ~ '+h.periodEnd+'</td><td>'+h.entitled+'</td><td>'+h.used+'</td><td>'+h.forfeited+'</td><td>NT$ '+h.forfeitedPay.toLocaleString()+'</td></tr>';
    });
    queryHtml += '</tbody></table></div></div>';
  }

  queryHtml += '<div class="card"><h2>其他假別總覽</h2><div class="table-scroll" id="otherLeaveOverview"><div class="empty">載入中…</div></div></div>';

  queryHtml += '<div class="card"><h2>LINE 通知綁定</h2>' +
    '<p class="hint">綁定後，請假審核結果會透過 LINE 通知您（跟 Email 通知同時發送）。</p>' +
    '<button class="ghost" onclick="doGetLineCode(\'emp\')">取得綁定驗證碼</button>' +
    '<div id="empLineCodeResult"></div></div>';

  const leaveOptions = ['特休'].concat(OTHER_LEAVE_TYPES)
    .map(t => '<option value="'+t+'">'+t+'</option>').join('');

  const applyHtml =
    '<div class="card"><h2>請假申請</h2>' +
    '<label>假別</label>' +
    '<select id="reqLeaveType" onchange="onLeaveTypeChange()">' + leaveOptions + '</select>' +
    '<div id="leaveQuotaInfo" style="margin-top:10px;">' +
      renderQuotaPanel_(leave) +
    '</div>' +
    '<div class="row" style="margin-top:12px;">' +
      '<div><label>開始日</label><input type="date" id="reqStart"></div>' +
      '<div><label>結束日</label><input type="date" id="reqEnd"></div>' +
    '</div>' +
    '<label>事由（選填）</label><textarea id="reqReason" placeholder="例如：家庭旅遊"></textarea>' +
    '<button class="primary" onclick="doSubmitLeave()">送出申請</button>' +
    '<p class="hint">特休／事假／病假會依剩餘天數自動檢查；婚假／喪假／產假天數僅供參考，交由主管審核判斷。</p>' +
    '<div id="submitLeaveMsg"></div>' +
    '</div>' +
    '<div class="card"><h2>我的請假紀錄</h2><div class="table-scroll" id="myLeaveList"><div class="empty">載入中…</div></div></div>';

  const html =
    '<div class="tabs">' +
      '<button class="tab-btn active" data-tab="empTabQuery" onclick="switchEmpTab(\'empTabQuery\')">特休查詢</button>' +
      '<button class="tab-btn" data-tab="empTabApply" onclick="switchEmpTab(\'empTabApply\')">請假申請</button>' +
    '</div>' +
    '<div class="tab-content active" id="empTabQuery">' + queryHtml + '</div>' +
    '<div class="tab-content" id="empTabApply">' + applyHtml + '</div>';

  document.getElementById('empDashboard').innerHTML = html;
  switchEmpTab(EMP_TARGET_TAB);
  loadOtherLeaveOverview();
  loadMyLeaveRequests();
}

function doGetLineCode(who){
  const resultElId = who === 'hr' ? 'hrLineCodeResult' : 'empLineCodeResult';
  const payload = who === 'hr' ? { token: ADMIN_TOKEN } : { nationalId: CURRENT_EMPLOYEE.nationalId };
  document.getElementById(resultElId).innerHTML = '<div class="empty">產生中…</div>';
  callApi('generateLineLinkCode', payload)
    .then(function(res){
      document.getElementById(resultElId).innerHTML =
        '<div class="msg ok">驗證碼：<strong style="font-size:18px;">' + res.code + '</strong>　（10 分鐘內有效）</div>' +
        '<p class="hint">步驟：1. 加官方帳號好友 → <a href="' + res.addFriendUrl + '" target="_blank">點此加入 LINE 好友</a>（或搜尋 ID：' + res.lineOaId + '）　2. 在對話框輸入上面這組驗證碼，即完成綁定。</p>';
    })
    .catch(function(err){
      document.getElementById(resultElId).innerHTML = '<div class="msg error">' + (err.message || err) + '</div>';
    });
}

function loadOtherLeaveOverview(){
  const el = document.getElementById('otherLeaveOverview');
  if(!el) return;
  let html = '<table><thead><tr><th>假別</th><th>本期/預設天數</th><th>已用</th><th>剩餘／備注</th></tr></thead><tbody>';
  OTHER_LEAVE_TYPES.forEach(type=>{ html += '<tr id="otherLeaveRow_'+type+'"><td>'+type+'</td><td colspan="3">載入中…</td></tr>'; });
  html += '</tbody></table>';
  el.innerHTML = html;

  OTHER_LEAVE_TYPES.forEach(type=>{
    callApi('getLeaveQuota', { nationalId: CURRENT_EMPLOYEE.nationalId, leaveType: type })
      .then(function(quota){
        const row = document.getElementById('otherLeaveRow_'+type);
        if(!row) return;
        if(quota.mode === 'event'){
          row.innerHTML = '<td>'+type+'</td><td>'+quota.defaultDays+' 天（參考）</td><td>'+quota.usedAllTime+'</td><td>僅供參考，由主管審核</td>';
        } else {
          const c = quota.current;
          row.innerHTML = '<td>'+type+'</td><td>'+c.entitled+'</td><td>'+c.used+'</td><td>'+c.remaining+'（到期 '+c.periodEnd+'）</td>';
        }
      })
      .catch(function(err){
        const row = document.getElementById('otherLeaveRow_'+type);
        if(row) row.innerHTML = '<td>'+type+'</td><td colspan="3">'+(err.message||err)+'</td>';
      });
  });
}

function badgeHtml(status){
  const icons = {'待審核':'○','已核准':'✓','已拒絕':'✕','在職':'●','離職':'–'};
  return '<span class="badge '+status+'">'+(icons[status]||'')+' '+status+'</span>';
}

function statBox(k, v, accent){
  return '<div class="stat"><div class="k">'+k+'</div><div class="v'+(accent?' accent':'')+'">'+v+'</div></div>';
}

function renderQuotaPanel_(quota){
  if(quota.mode === 'event'){
    return '<p class="hint">'+quota.note+'　（歷史已核准使用：'+quota.usedAllTime+' 天）</p>';
  }
  if(quota.eligible === false){
    return '<p class="hint">'+quota.message+'（預計 '+quota.nextEligibleDate+' 起可申請）</p>';
  }
  const c = quota.current;
  return '<div class="stat-grid">' +
    statBox('本期天數', c.entitled+' 天') +
    statBox('已用天數', c.used+' 天') +
    statBox('剩餘天數', c.remaining+' 天', true) +
    statBox('到期日', c.periodEnd) +
    '</div>';
}

function onLeaveTypeChange(){
  const type = document.getElementById('reqLeaveType').value;
  const el = document.getElementById('leaveQuotaInfo');
  el.innerHTML = '<div class="empty">載入中…</div>';
  callApi('getLeaveQuota', { nationalId: CURRENT_EMPLOYEE.nationalId, leaveType: type })
    .then(function(quota){ el.innerHTML = renderQuotaPanel_(quota); })
    .catch(function(err){ el.innerHTML = '<div class="msg error">'+(err.message||err)+'</div>'; });
}

function doSubmitLeave(){
  const leaveType = document.getElementById('reqLeaveType').value;
  const startDate = document.getElementById('reqStart').value;
  const endDate = document.getElementById('reqEnd').value;
  const reason = document.getElementById('reqReason').value;
  if(!startDate || !endDate){ showMsg('submitLeaveMsg','請選擇開始與結束日期。', false); return; }

  callApi('submitLeaveRequest', {
    nationalId: CURRENT_EMPLOYEE.nationalId,
    name: CURRENT_EMPLOYEE.name,
    leaveType: leaveType,
    startDate: startDate,
    endDate: endDate,
    reason: reason
  })
    .then(function(res){
      showMsg('submitLeaveMsg', '申請已送出（'+res.days+' 天），等待審核。', true);
      return callApi('getLeaveSummary', { nationalId: CURRENT_EMPLOYEE.nationalId });
    })
    .then(function(leave){
      EMP_TARGET_TAB = 'empTabApply';
      renderEmpDashboard(CURRENT_EMPLOYEE, leave);
      document.getElementById('reqLeaveType').value = leaveType;
      onLeaveTypeChange();
    })
    .catch(function(err){ showMsg('submitLeaveMsg', err.message || String(err), false); });
}

function loadMyLeaveRequests(){
  callApi('getMyLeaveRequests', { nationalId: CURRENT_EMPLOYEE.nationalId })
    .then(function(list){
      const el = document.getElementById('myLeaveList');
      if(!el) return;
      if(!list.length){ el.innerHTML = '<div class="empty">尚無申請紀錄。</div>'; return; }
      let html = '<table><thead><tr><th>申請日</th><th>假別</th><th>期間</th><th>天數</th><th>事由</th><th>狀態</th></tr></thead><tbody>';
      list.forEach(r=>{
        html += '<tr><td>'+r.appliedAt+'</td><td>'+(r.leaveType||'特休')+'</td><td>'+r.startDate+' ~ '+r.endDate+'</td><td>'+r.days+'</td><td>'+(r.reason||'-')+'</td>' +
                '<td>'+badgeHtml(r.status) + (r.status==='已拒絕' && r.rejectReason ? '<div class="hint">'+r.rejectReason+'</div>' : '') + '</td></tr>';
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    })
    .catch(function(err){ console.error(err); });
}

/* ---------------- 新進員工資料填寫 ---------------- */
function doSubmitNewHire(){
  const payload = {
    branch: nval('n_branch'),
    employeeType: nval('n_employeeType'),
    position: nval('n_position'),
    name: nval('n_name'),
    nickname: nval('n_nickname'),
    hireDate: nval('n_hireDate'),
    nationalId: nval('n_nationalId'),
    birthDate: nval('n_birthDate'),
    gender: nval('n_gender'),
    householdAddress: nval('n_householdAddress'),
    mailingAddress: nval('n_mailingAddress'),
    homePhone: nval('n_homePhone'),
    mobilePhone: nval('n_mobilePhone'),
    education: nval('n_education'),
    hometown: nval('n_hometown'),
    insuranceDate: nval('n_insuranceDate'),
    salary: nval('n_salary'),
    emergencyContact: nval('n_emergencyContact'),
    emergencyRelation: nval('n_emergencyRelation'),
    emergencyPhone: nval('n_emergencyPhone'),
    note: nval('n_note'),
    ig: nval('n_ig'),
    lineId: nval('n_lineId'),
    resignDate: nval('n_resignDate'),
    account: nval('n_account'),
    email: nval('n_email')
  };
  callApi('submitNewHireForm', payload)
    .then(function(res){
      showMsg('newHireMsg', '資料已送出（提交編號：'+res.submissionId+'），請等候人資審核建立。', true);
      document.querySelectorAll('#panelNewHire input, #panelNewHire select, #panelNewHire textarea').forEach(el=>el.value='');
    })
    .catch(function(err){ showMsg('newHireMsg', err.message || String(err), false); });
}

function nval(id){ return document.getElementById(id).value; }

/* ---------------- HR / 主管後台 ---------------- */
function doAdminLogin(){
  const email = document.getElementById('adminEmail').value.trim();
  callApi('adminLogin', { email: email })
    .then(function(res){
      if(!res.success){ showMsg('adminLoginMsg', res.message, false); return; }
      ADMIN_TOKEN = res.token;
      document.getElementById('adminLoginCard').style.display = 'none';
      document.getElementById('adminDashboard').style.display = 'block';
      loadEmployeeList();
      loadPendingRequests();
      loadPendingNewHires();
      identifyOneSignalHR_();
    })
    .catch(function(err){ showMsg('adminLoginMsg', err.message || String(err), false); });
}

/* ---------------- OneSignal 推播訂閱設定 ---------------- */
function identifyOneSignalEmployee_(nationalId){
  if (!window.OneSignalDeferred) return;
  OneSignalDeferred.push(async function(OneSignal){
    try {
      await OneSignal.login(nationalId); // 用身份證字號當作 OneSignal 的外部 ID，方便之後精準推播給這個人
      await OneSignal.Notifications.requestPermission();
    } catch(e){ console.warn('OneSignal 訂閱設定失敗：', e); }
  });
}

function identifyOneSignalHR_(){
  if (!window.OneSignalDeferred) return;
  OneSignalDeferred.push(async function(OneSignal){
    try {
      await OneSignal.User.addTag('role', 'hr'); // 標記這個裝置是HR/主管，之後推播可以用這個標籤鎖定
      await OneSignal.Notifications.requestPermission();
    } catch(e){ console.warn('OneSignal 訂閱設定失敗：', e); }
  });
}

function adminLogout(){
  ADMIN_TOKEN = null;
  document.getElementById('adminDashboard').style.display = 'none';
  document.getElementById('adminLoginCard').style.display = 'block';
  document.getElementById('adminEmail').value = '';
}

function switchAdminTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('active', c.id===tab));
  if(tab==='tabList') loadEmployeeList();
  if(tab==='tabPending') loadPendingRequests();
  if(tab==='tabNewHire') loadPendingNewHires();
}

function doAddEmployee(){
  const payload = {
    token: ADMIN_TOKEN,
    branch: val('f_branch'),
    employeeType: val('f_employeeType'),
    position: val('f_position'),
    name: val('f_name'),
    nickname: val('f_nickname'),
    hireDate: val('f_hireDate'),
    nationalId: val('f_nationalId'),
    birthDate: val('f_birthDate'),
    gender: val('f_gender'),
    householdAddress: val('f_householdAddress'),
    mailingAddress: val('f_mailingAddress'),
    homePhone: val('f_homePhone'),
    mobilePhone: val('f_mobilePhone'),
    education: val('f_education'),
    hometown: val('f_hometown'),
    insuranceDate: val('f_insuranceDate'),
    salary: val('f_salary'),
    emergencyContact: val('f_emergencyContact'),
    emergencyRelation: val('f_emergencyRelation'),
    emergencyPhone: val('f_emergencyPhone'),
    note: val('f_note'),
    ig: val('f_ig'),
    lineId: val('f_lineId'),
    resignDate: val('f_resignDate'),
    account: val('f_account'),
    email: val('f_email')
  };
  callApi('addEmployee', payload)
    .then(function(res){
      showMsg('addEmpMsg', '新增成功！身份證字號：' + res.nationalId, true);
      document.querySelectorAll('#tabAdd input, #tabAdd select, #tabAdd textarea').forEach(el=>el.value='');
      loadEmployeeList();
    })
    .catch(function(err){ showMsg('addEmpMsg', err.message || String(err), false); });
}

function val(id){ return document.getElementById(id).value; }

function loadEmployeeList(){
  if(!ADMIN_TOKEN) return;
  callApi('getAllEmployeesForAdmin', { token: ADMIN_TOKEN })
    .then(function(list){
      const el = document.getElementById('empListWrap');
      if(!list.length){ el.innerHTML = '<div class="empty">尚無員工資料。</div>'; return; }
      let html = '<table><thead><tr><th>身份證字號</th><th>店點</th><th>職位</th><th>姓名</th><th>暱稱</th><th>到職日</th><th>銀行帳號</th><th>狀態</th><th>本期特休</th><th>已用/剩餘</th><th>到期日</th></tr></thead><tbody>';
      list.forEach(e=>{
        const l = e.leave;
        const cur = l.eligible ? (l.current.used + ' / ' + l.current.remaining) : '-';
        const exp = l.eligible ? l.current.periodEnd : (l.nextEligibleDate || '-');
        const entitled = l.eligible ? l.current.entitled : 0;
        html += '<tr style="cursor:pointer" onclick="openEmployeeDetail(\''+e.nationalId+'\')" title="點選查看/編輯詳細資料">' +
                '<td>'+e.nationalId+'</td><td>'+(e.branch||'-')+'</td><td>'+(e.position||'-')+'</td><td>'+e.name+'</td><td>'+(e.nickname||'-')+'</td><td>'+e.hireDate+'</td><td>'+(e.account||'-')+'</td>' +
                '<td>'+badgeHtml(e.status)+'</td><td>'+entitled+'</td><td>'+cur+'</td><td>'+exp+'</td></tr>';
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    })
    .catch(function(err){ document.getElementById('empListWrap').innerHTML = '<div class="msg error">'+(err.message||err)+'</div>'; });
}

function openEmployeeDetail(nationalId){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('active', c.id==='tabDetail'));
  document.getElementById('detailLeaveCard').innerHTML = '<div class="empty">載入中…</div>';
  callApi('getEmployeeDetail', { token: ADMIN_TOKEN, nationalId: nationalId })
    .then(function(res){
      const emp = res.employee;
      document.getElementById('e_originalNationalId').value = emp.nationalId;
      ['branch','employeeType','position','name','nickname','hireDate','nationalId','birthDate','gender',
       'householdAddress','mailingAddress','homePhone','mobilePhone','education','hometown','insuranceDate',
       'salary','emergencyContact','emergencyRelation','emergencyPhone','note','ig','lineId','resignDate','account','email']
      .forEach(k => { const el = document.getElementById('e_'+k); if(el) el.value = emp[k] || ''; });

      const l = res.leave;
      let lh = '<h2>'+emp.name+' 的特休狀態　<span style="font-size:12px;color:var(--ink-soft);font-weight:400;">('+badgeHtml(res.status)+')</span></h2>';
      if(!l.eligible){
        lh += '<p class="hint">'+l.message+'（預計 '+l.nextEligibleDate+' 起取得特休）</p>';
      } else {
        const c = l.current;
        lh += '<div class="stat-grid">' +
              statBox('本期('+c.label+')特休天數', c.entitled+' 天') +
              statBox('已使用', c.used+' 天') +
              statBox('剩餘天數', c.remaining+' 天', true) +
              statBox('本期到期日', c.periodEnd) +
              '</div>';
      }
      document.getElementById('detailLeaveCard').innerHTML = lh;
      document.getElementById('updateEmpMsg').innerHTML = '';
    })
    .catch(function(err){
      document.getElementById('detailLeaveCard').innerHTML = '<div class="msg error">'+(err.message||err)+'</div>';
    });
}

function doUpdateEmployee(){
  const payload = {
    token: ADMIN_TOKEN,
    originalNationalId: val('e_originalNationalId'),
    branch: val('e_branch'),
    employeeType: val('e_employeeType'),
    position: val('e_position'),
    name: val('e_name'),
    nickname: val('e_nickname'),
    hireDate: val('e_hireDate'),
    nationalId: val('e_nationalId'),
    birthDate: val('e_birthDate'),
    gender: val('e_gender'),
    householdAddress: val('e_householdAddress'),
    mailingAddress: val('e_mailingAddress'),
    homePhone: val('e_homePhone'),
    mobilePhone: val('e_mobilePhone'),
    education: val('e_education'),
    hometown: val('e_hometown'),
    insuranceDate: val('e_insuranceDate'),
    salary: val('e_salary'),
    emergencyContact: val('e_emergencyContact'),
    emergencyRelation: val('e_emergencyRelation'),
    emergencyPhone: val('e_emergencyPhone'),
    note: val('e_note'),
    ig: val('e_ig'),
    lineId: val('e_lineId'),
    resignDate: val('e_resignDate'),
    account: val('e_account'),
    email: val('e_email')
  };
  callApi('updateEmployee', payload)
    .then(function(res){
      showMsg('updateEmpMsg', '已儲存變更。', true);
      openEmployeeDetail(res.nationalId);
    })
    .catch(function(err){ showMsg('updateEmpMsg', err.message || String(err), false); });
}

function loadPendingRequests(){
  if(!ADMIN_TOKEN) return;
  callApi('getPendingRequests', { token: ADMIN_TOKEN })
    .then(function(list){
      const el = document.getElementById('pendingWrap');
      if(!list.length){ el.innerHTML = '<div class="empty">目前沒有待審核的假單。</div>'; return; }
      let html = '<table><thead><tr><th>申請編號</th><th>員工</th><th>假別</th><th>期間</th><th>天數</th><th>事由</th><th>操作</th></tr></thead><tbody>';
      list.forEach(r=>{
        html += '<tr><td>'+r.requestId+'</td><td>'+r.name+' ('+r.nationalId+')</td><td>'+(r.leaveType||'特休')+'</td><td>'+r.startDate+' ~ '+r.endDate+'</td><td>'+r.days+'</td><td>'+(r.reason||'-')+'</td>' +
                '<td><button class="small-approve" onclick="doReview(\''+r.requestId+'\',\'approve\')">核准</button>' +
                '<button class="small-reject" onclick="doReview(\''+r.requestId+'\',\'reject\')">拒絕</button></td></tr>';
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    })
    .catch(function(err){ document.getElementById('pendingWrap').innerHTML = '<div class="msg error">'+(err.message||err)+'</div>'; });
}

function doReview(requestId, decision){
  let rejectReason = '';
  if(decision === 'reject'){
    rejectReason = prompt('請輸入拒絕原因（選填）：') || '';
  }
  callApi('reviewLeaveRequest', { token: ADMIN_TOKEN, requestId: requestId, decision: decision, rejectReason: rejectReason })
    .then(function(){ loadPendingRequests(); loadEmployeeList(); })
    .catch(function(err){ alert(err.message || err); });
}

function loadPendingNewHires(){
  if(!ADMIN_TOKEN) return;
  callApi('getPendingNewHires', { token: ADMIN_TOKEN })
    .then(function(list){
      const el = document.getElementById('newHirePendingWrap');
      if(!list.length){ el.innerHTML = '<div class="empty">目前沒有待審核的新進員工資料。</div>'; return; }
      let html = '<table><thead><tr><th>提交編號</th><th>姓名</th><th>身份證字號</th><th>店點</th><th>職位</th><th>到職日</th><th>手機</th><th>操作</th></tr></thead><tbody>';
      list.forEach(r=>{
        html += '<tr><td>'+r.submissionId+'</td><td>'+r.name+'</td><td>'+r.nationalId+'</td><td>'+(r.branch||'-')+'</td><td>'+(r.position||'-')+'</td><td>'+r.hireDate+'</td><td>'+(r.mobilePhone||'-')+'</td>' +
                '<td><button class="small-approve" onclick="doReviewNewHire(\''+r.submissionId+'\',\'approve\')">核准建立</button>' +
                '<button class="small-reject" onclick="doReviewNewHire(\''+r.submissionId+'\',\'reject\')">忽略</button></td></tr>';
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    })
    .catch(function(err){ document.getElementById('newHirePendingWrap').innerHTML = '<div class="msg error">'+(err.message||err)+'</div>'; });
}

function doReviewNewHire(submissionId, decision){
  if(decision === 'reject' && !confirm('確定要忽略這筆新進員工提交嗎？')) return;
  const action = decision === 'approve' ? 'approveNewHire' : 'rejectNewHire';
  callApi(action, { token: ADMIN_TOKEN, submissionId: submissionId })
    .then(function(){ loadPendingNewHires(); loadEmployeeList(); })
    .catch(function(err){ alert(err.message || err); });
}

// ---------- Service Worker 註冊（讓網頁可以離線快取外觀、支援加入主畫面）----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('service-worker.js').catch(function(err){
      console.warn('Service worker 註冊失敗：', err);
    });
  });
}
