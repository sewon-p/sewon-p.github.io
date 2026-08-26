import"./modulepreload-polyfill-P2Xu9kJm.js";import{i as e}from"./itemFamilyCatalog-Bg6oLdVG.js";import{a as t,c as n,d as r,f as i,g as a,h as o,l as s,m as c,o as l,p as u,s as d,t as f,w as p}from"./campaignStorage-BNPuMrvo.js";import{c as m,f as h,m as g,p as _,u as v}from"./items-7y8u6p4z.js";var y=document.querySelector(`#campaign-lab`);if(y===null)throw Error(`Campaign lab root is missing`);var b=y,x=e,S={"quality-first-fast":`고품질 집중`,balanced:`균형 연구`,conservative:`보수 연구`},C={"already-unlocked":`이미 해금했습니다.`,"item-locked":`먼저 아이템을 해금해야 합니다.`,"rank-maxed":`수량 랭크가 최대입니다.`,"insufficient-research":`연구 포인트가 부족합니다.`,"already-cleared":`이미 정복한 관문입니다.`,"speed-grade-already-claimed":`속도 보상을 이미 받았습니다.`,"invalid-speed-grade":`속도 등급이 올바르지 않습니다.`,"planet-not-cleared":`행성을 먼저 돌파해야 합니다.`,"no-ranks-to-respec":`되돌릴 수량 랭크가 없습니다.`},w=t(),T=`저장된 연구 프로필을 불러왔습니다.`;b.innerHTML=`
  <div class="campaign-shell">
    <header class="campaign-header">
      <div>
        <p>TO THE SPACE! RESEARCH DIVISION</p>
        <h1>연구실</h1>
        <span>72관문 경제 · 8종 덱 배분 · 저장 프로필</span>
      </div>
      <a href="/" data-campaign-back>게임으로 돌아가기</a>
    </header>

    <section class="campaign-kpis" aria-label="캠페인 현황">
      <article><span>RESEARCH</span><strong data-campaign-rp>0</strong><small>RP</small></article>
      <article><span>NATURAL RUNS</span><strong data-campaign-plays>0</strong><small>회</small></article>
      <article><span>CLEARED</span><strong data-campaign-cleared>0 / 72</strong><small>관문</small></article>
      <article><span>FAMILY CAP</span><strong data-campaign-capacity>5</strong><small>장씩</small></article>
    </section>

    <p class="campaign-notice" data-campaign-notice role="status" aria-live="polite"></p>

    <section class="campaign-panel campaign-roster" aria-labelledby="campaign-roster-title">
      <div class="campaign-panel-heading">
        <div><p>DECK ENGINEERING</p><h2 id="campaign-roster-title">8종 적재 설계</h2></div>
        <button type="button" data-campaign-respec>수량 랭크 재분배</button>
      </div>
      <p class="campaign-rule">각 계열은 최소 1장 선배정 후 기본 가중치+수량 랭크로 최대잔여 정수 배분합니다. 해금은 총량이 아니라 조합 선택지를 늘립니다.</p>
      <div class="campaign-item-grid" data-campaign-items></div>
    </section>

    <section class="campaign-panel" aria-labelledby="campaign-sim-title">
      <div class="campaign-panel-heading">
        <div><p>DETERMINISTIC LONG RUN</p><h2 id="campaign-sim-title">72관문 시간 가드</h2></div>
        <span class="campaign-seed" data-campaign-seed></span>
      </div>
      <p class="campaign-rule">실제 렌더 맵이 아니라 경제·해금·카드 출력의 결정론적 장거리 모델입니다. 빠른 전략도 180분 아래로 내려가면 실패입니다.</p>
      <div class="campaign-sim-grid" data-campaign-simulations></div>
      <div class="campaign-gate-contract">
        <span><b>1</b>C01 충전</span>
        <span><b>59</b>일반 보급</span>
        <span><b>11</b>행성 전환</span>
        <span><b>1</b>C72 피날레</span>
      </div>
    </section>

    <section class="campaign-panel campaign-ledger" aria-labelledby="campaign-ledger-title">
      <div><p>RESEARCH LEDGER</p><h2 id="campaign-ledger-title">연구 원장</h2></div>
      <dl>
        <div><dt>총 수입</dt><dd data-ledger-earned>0 RP</dd></div>
        <div><dt>총 지출</dt><dd data-ledger-spent>0 RP</dd></div>
        <div><dt>재분배 반환</dt><dd data-ledger-returned>0 RP</dd></div>
        <div><dt>대차 검증</dt><dd data-ledger-status>PASS</dd></div>
      </dl>
    </section>
  </div>
`;function E(e){let t=b.querySelector(e);if(t===null)throw Error(`Campaign lab element missing: ${e}`);return t}var D=E(`[data-campaign-rp]`),O=E(`[data-campaign-plays]`),k=E(`[data-campaign-cleared]`),A=E(`[data-campaign-capacity]`),j=E(`[data-campaign-notice]`),M=E(`[data-campaign-items]`),N=E(`[data-campaign-simulations]`),P=E(`[data-campaign-respec]`),F=E(`[data-campaign-seed]`),I=E(`[data-ledger-earned]`),L=E(`[data-ledger-spent]`),R=E(`[data-ledger-returned]`),z=E(`[data-ledger-status]`);function B(e){return e.toLocaleString(`ko-KR`)}function V(e,t){let n=e.quantityRanks[t];return n>=4?null:g[t][n]??null}function H(e,t){let n=p[t],i=e.unlockedItemIds.includes(t),a=e.quantityRanks[t],o=_[t],s=V(e,t),c=r(e)[t],l=i?`rank`:`unlock`,u=i?s:o,d=u===null||e.researchPoints<u,f=i?s===null?`RANK MAX`:`수량 R${a+1} · ${s} RP`:`해금 · ${o??0} RP`;return`
    <article class="campaign-item" data-item="${t}" data-family="${n.synergyType}" data-unlocked="${String(i)}">
      <div class="campaign-item-icon" aria-hidden="true"></div>
      <div class="campaign-item-copy">
        <span>${x[h[t]]} 고정 · WEIGHT ${v[t]}+${a}</span>
        <h3>${n.label}</h3>
        <p>${n.impulseVelocity.toFixed(1)} m/s · 추력 ${n.thrustAcceleration.toFixed(1)} · ${n.durationSeconds.toFixed(1)}초</p>
      </div>
      <div class="campaign-item-stock"><b>${c}</b><span>장</span></div>
      <button type="button" data-item-action="${l}" data-item-id="${t}" ${d?`disabled`:``}>${f}</button>
    </article>
  `}function U(e){let t=s({seed:w.runSeed,strategy:e}),n=Math.floor(t.totalMinutes/60),r=Math.round(t.totalMinutes%60);return`
    <article class="campaign-simulation" data-strategy="${e}" data-guard="${t.guardStatus.pass?`pass`:`tune`}">
      <span>${S[e]}</span>
      <strong>${n}시간 ${r}분</strong>
      <dl>
        <div><dt>자연 결과</dt><dd>${t.totalAttempts}회</dd></div>
        <div><dt>연구 수입</dt><dd>${t.totalResearchEarned} RP</dd></div>
        <div><dt>연구 지출</dt><dd>${t.totalResearchSpent} RP</dd></div>
        <div><dt>8종 해금</dt><dd>${t.allItemsUnlocked?`완료`:`미완료`}</dd></div>
      </dl>
      <b>${t.guardStatus.pass?`TIME GUARD PASS`:`TUNE REQUIRED`}</b>
    </article>
  `}function W(){D.textContent=B(w.researchPoints),O.textContent=w.completedPlayCount.toLocaleString(`ko-KR`),k.textContent=`${w.clearedCheckpointIds.length} / 72`,A.textContent=i(w.completedPlayCount).toLocaleString(`ko-KR`),F.textContent=`SEED ${w.runSeed.toString(16).padStart(8,`0`).toUpperCase()}`,j.textContent=T,M.innerHTML=m.map(e=>H(w,e)).join(``),N.innerHTML=n.map(U).join(``),I.textContent=`${B(w.totalEarned)} RP`,L.textContent=`${B(w.totalSpent)} RP`,R.textContent=`${B(w.totalReturned)} RP`;let e=a(w);z.textContent=e?`PASS`:`ERROR`,z.dataset.status=e?`pass`:`error`,P.disabled=m.every(e=>w.quantityRanks[e]===0)}async function G(e){let t=e.dataset.itemId,n=e.dataset.itemAction,r=null,i=``;w=await d(e=>{let a=n===`unlock`?u(e,t):c(e,t);return a.ok?(i=n===`unlock`?`${p[t].label} 해금 · 다음 런부터 덱 후보에 편입됩니다.`:`${p[t].label} 수량 R${a.profile.quantityRanks[t]} 적용.`,a.profile):(r=a.reason,null)}),T=r===null?i:C[r],W()}M.addEventListener(`click`,e=>{let t=e.target.closest(`button[data-item-action]`);t===null||t.disabled||(t.disabled=!0,G(t))}),P.addEventListener(`click`,()=>{P.disabled=!0,d(e=>{let t=o(e);return t.ok?(T=`수량 랭크 초기화 · ${t.returned} RP 반환 · 수수료 ${t.spent} RP.`,t.profile):(T=C[t.reason],null)}).then(e=>{w=e,W()})}),window.addEventListener(f,()=>{w=t(),W()}),window.addEventListener(`storage`,e=>{(e.key===null||e.key===`openai-game.campaign-profile.v1`)&&(w=l(),W())}),W();