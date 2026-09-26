/* ============================================================
   Shared by the outlet picker (index.html) and the outlet
   site (punggol/). Holland is marked comingSoon: shown greyed
   out in the picker, never open, no page of its own yet.

   - OUTLETS: everything that differs between the two outlets
     apart from the menu (the menu lives in each outlet page).
   - normalizeStatus(): turns the Apps Script reply into
     { outlets: { punggol:{open,dates}, holland:{open,dates} }, ... }
   - makeSchedule(): the opening-dates list + add-to-calendar menu.
   ============================================================ */
(function(){
  var GM = window.GM = {};

  // The site folder, worked out from where this file lives (outlets.js),
  // so images load from any page depth, uploaded or opened from the computer.
  var me = document.currentScript && document.currentScript.src;
  GM.ROOT = me ? new URL('../', me).href : '/';

  /* Folder links ("punggol/", "../") open index.html by themselves on a web
     server, but not when the file is opened straight from the computer. */
  var LOCAL = location.protocol === 'file:';
  GM.href = function(path){
    return (LOCAL && /\/$/.test(path)) ? path + 'index.html' : path;
  };
  if(LOCAL){
    document.addEventListener('DOMContentLoaded', function(){
      document.querySelectorAll('a[href$="/"]').forEach(function(a){
        var h = a.getAttribute('href');
        if(!/^[a-z]+:/i.test(h)) a.setAttribute('href', h + 'index.html');
      });
    });
  }

  // ---- The two outlets ----------------------------------------------------
  // `pickup` is the line printed on the order confirmation.
  GM.OUTLETS = {
    punggol: {
      id: 'punggol', name: 'Punggol', path: 'punggol/',
      address: '268A Punggol Fld, 821268',
      pickup: 'Level 5',
      star: 'Star-Punggol.png',    // yellow: this outlet's star on the closed page
      pin: 'button-4.png',         // yellow craft button pinned on its tag in the picker
      short: '268A Punggol Fld'
    },
    holland: {
      id: 'holland', name: 'Holland', path: 'holland/',
      address: '7 Commonwealth Avenue, 140007',
      pickup: 'Level 2',
      star: 'Star-Holland.png',    // purple
      pin: 'button-8.png',         // purple craft button
      short: '7 Commonwealth Ave',
      comingSoon: true             // greyed out everywhere; flip to false when it opens
    }
  };
  GM.ORDER = ['punggol', 'holland'];
  GM.other = function(id){ return id === 'punggol' ? 'holland' : 'punggol'; };

  // ---- The Apps Script ------------------------------------------------------
  // One link for the picker and both outlets: the two-outlet code.gs
  // deployment (code.gs).
  GM.SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzTbXhy01ydd5YdaM5VCU--ddg58nnayKB5KZ0VDXRbWkWCPQLUVfgbMCjnZiDizNZA/exec';

  // ---- Status reply -> per-outlet shape -------------------------------------
  /* The two-outlet script (code.gs) answers:
       { ok:true, outlets:{ punggol:{ open, dates:[...], soldOut:[...], soldOutMilks:[...] },
                            holland:{ ... } } }
     The old one-shop script only has top-level open/dates/soldOut, so those
     are read as Punggol's and Holland reads as closed. */
  GM.normalizeStatus = function(s){
    var out = { ok: !!s, outlets: {} };
    GM.ORDER.forEach(function(id){ out.outlets[id] = { open: false, dates: [], soldOut: [], soldOutMilks: [] }; });
    if(!s) return out;
    function arr(v){ return Array.isArray(v) ? v : []; }
    if(s.outlets && typeof s.outlets === 'object'){
      GM.ORDER.forEach(function(id){
        var o = s.outlets[id] || {};
        out.outlets[id] = { open: o.open === true, dates: arr(o.dates),
                            soldOut: arr(o.soldOut), soldOutMilks: arr(o.soldOutMilks) };
      });
    } else {
      out.outlets.punggol = { open: s.open === true, dates: arr(s.dates),
                              soldOut: arr(s.soldOut), soldOutMilks: arr(s.soldOutMilks) };
    }
    // Coming-soon outlets are never open, whatever the sheet says.
    GM.ORDER.forEach(function(id){ if(GM.OUTLETS[id].comingSoon) out.outlets[id].open = false; });
    return out;
  };

  /* "Open now" / "Next open Sat 27 Sep, 10am–6pm" / "No dates yet". */
  GM.nextOpenLabel = function(dates){
    var now = Date.now(), best = null;
    (dates || []).forEach(function(d){
      if(!d || !d.start || !d.end || +d.end < now) return;
      if(!best || +d.start < +best.start) best = d;
    });
    if(!best) return 'New dates dropping soon';
    function hl(ms){
      var dt = new Date(+ms + 8*3600000), h = dt.getUTCHours(), m = dt.getUTCMinutes();
      return (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + (h >= 12 ? 'pm' : 'am');
    }
    var a = hl(best.start), b = hl(best.end);
    if(a.slice(-2) === b.slice(-2)) a = a.slice(0, -2);
    var dt = new Date(+best.start + 8*3600000);
    var WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return 'Next open ' + WD[dt.getUTCDay()] + ' ' + dt.getUTCDate() + ' ' + MO[dt.getUTCMonth()] + ', ' + a + '–' + b;
  };

  /* Short form for the picker's stamp: "back Fri 25", or "new dates soon". */
  GM.backLabel = function(dates){
    var now = Date.now(), best = null;
    (dates || []).forEach(function(d){
      if(d && d.start && d.end && +d.end >= now && (!best || +d.start < +best.start)) best = d;
    });
    if(!best) return 'new dates soon';
    var dt = new Date(+best.start + 8*3600000);
    return 'back ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()] + ' ' + dt.getUTCDate();
  };

  // ---- Opening dates + add-to-calendar --------------------------------------
  GM.makeSchedule = function(outlet, opts){
    // Hours come from the Google Calendar event itself -- nothing about opening time is hardcoded here.
    var TZ = 'Asia/Singapore', UTC_OFFSET = 8;
    var EVENT_TITLE = "Gens Matcha " + outlet.name + " — Open";
    var EVENT_LOC = outlet.address || "";
    function eventDesc(e){ return "We're open " + rangeLabel(e) + ". Come get your matcha fix ⭐"; }

    var WEEKDAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    var MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';

    function pad(n){ return (n<10?"0":"")+n; }

    // epoch ms -> UTC stamp (ICS DTSTAMP / Google Calendar link)
    function stampUTC(ms){
      var dt = new Date(ms);
      return dt.getUTCFullYear()+pad(dt.getUTCMonth()+1)+pad(dt.getUTCDate())+"T"+pad(dt.getUTCHours())+pad(dt.getUTCMinutes())+"00Z";
    }
    // epoch ms -> Singapore wall-clock stamp (ICS DTSTART;TZID=)
    function stampLocal(ms){
      var dt = new Date(ms + UTC_OFFSET*3600000);
      return dt.getUTCFullYear()+pad(dt.getUTCMonth()+1)+pad(dt.getUTCDate())+"T"+pad(dt.getUTCHours())+pad(dt.getUTCMinutes())+"00";
    }
    // epoch ms -> "8pm" / "9:30pm", read in Singapore time regardless of the visitor's clock
    function hourLabel(ms){
      var dt = new Date(ms + UTC_OFFSET*3600000);
      var h = dt.getUTCHours(), mi = dt.getUTCMinutes();
      return (h % 12 || 12) + (mi ? ":"+pad(mi) : "") + (h >= 12 ? "pm" : "am");
    }
    // "8-11pm" when both ends share a meridiem, "10pm-1am" when they don't
    function rangeLabel(e){
      var a = hourLabel(e.start), b = hourLabel(e.end);
      if(a.slice(-2) === b.slice(-2)) a = a.slice(0, -2);
      return a + "–" + b;
    }

    function vevent(e){
      return [
        "BEGIN:VEVENT",
        "UID:gensmatcha-"+outlet.id+"-"+e.date.replace(/-/g,"")+"@gensmatcha",
        "DTSTAMP:"+stampUTC(e.start),
        "DTSTART;TZID="+TZ+":"+stampLocal(e.start),
        "DTEND;TZID="+TZ+":"+stampLocal(e.end),
        "SUMMARY:"+EVENT_TITLE,
        EVENT_LOC ? "LOCATION:"+EVENT_LOC : null,
        "DESCRIPTION:"+eventDesc(e),
        "END:VEVENT"
      ].filter(Boolean).join("\r\n");
    }
    var VTIMEZONE = ["BEGIN:VTIMEZONE","TZID:"+TZ,"BEGIN:STANDARD","DTSTART:19700101T000000",
      "TZOFFSETFROM:+0800","TZOFFSETTO:+0800","TZNAME:+08","END:STANDARD","END:VTIMEZONE"].join("\r\n");
    function buildICS(list){
      return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Gens Matcha//Opening Dates//EN",
        "CALSCALE:GREGORIAN","METHOD:PUBLISH",VTIMEZONE,list.map(vevent).join("\r\n"),"END:VCALENDAR"].join("\r\n");
    }
    function downloadICS(list, filename){
      var blob = new Blob([buildICS(list)], { type:"text/calendar;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    }
    function googleUrl(e){
      var p = new URLSearchParams({ action:"TEMPLATE", text:EVENT_TITLE,
        dates: stampUTC(e.start)+"/"+stampUTC(e.end), details:eventDesc(e), ctz:TZ });
      if(EVENT_LOC) p.set("location", EVENT_LOC);
      return "https://calendar.google.com/calendar/render?"+p.toString();
    }

    var now = Date.now();
    function isPast(e){ return e.end < now; }

    var iconBag = [];
    function calIco(){
      if(iconBag.length === 0){
        iconBag = [1,2,3,4,5,6];
        for(var i=iconBag.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=iconBag[i];iconBag[i]=iconBag[j];iconBag[j]=t; }
      }
      return '<img class="cal-ico" src="' + GM.ROOT + 'img/button-'+iconBag.pop()+'.png" alt="">';
    }

    var groupsEl  = opts.groupsEl;
    var titleEl   = opts.titleEl;
    var noteEl    = opts.noteEl;
    var sectionEl = opts.sectionEl;
    var openMenu = null;
    function closeMenu(){
      if(openMenu){ openMenu.menu.classList.remove("open"); openMenu.btn.setAttribute("aria-expanded","false"); if(openMenu.row){ openMenu.row.style.zIndex = ""; } openMenu = null; }
    }

    function makeChip(e, isNext){
      var past = isPast(e);
      var label = WEEKDAY[e.wd] + " " + e.d;                         // chip text (month is in the header)
      var full  = WEEKDAY[e.wd] + ", " + MONTH_ABBR[e.m-1] + " " + e.d;   // full date for menu / a11y

      var btn = document.createElement("button");
      btn.className = "date" + (past?" past":"") + (isNext?" next":"");
      btn.type = "button";
      btn.innerHTML = calIco() + '<span>' + label + '</span>';

      var cell = document.createElement("span");
      cell.style.position = "relative"; cell.style.display = "inline-block";
      cell.appendChild(btn);

      if(past){
        btn.disabled = true; btn.setAttribute("aria-disabled","true");
        btn.setAttribute("aria-label", full+" — past");
        return cell;
      }
      btn.setAttribute("aria-haspopup","true"); btn.setAttribute("aria-expanded","false");
      if(isNext){ btn.setAttribute("aria-label", full+" — next open date"); }

      var menu = document.createElement("div");
      menu.className = "cal-menu"; menu.setAttribute("role","menu");
      menu.innerHTML = '<div class="cal-menu-title">'+full+' &middot; '+rangeLabel(e)+'</div>';

      var icsBtn = document.createElement("button");
      icsBtn.type = "button"; icsBtn.className = "cal-opt"; icsBtn.setAttribute("role","menuitem");
      icsBtn.innerHTML = CAL_ICON + '<span>Apple Calendar</span>';
      icsBtn.addEventListener("click", function(ev){ ev.stopPropagation(); downloadICS([e], "gens-matcha-"+outlet.id+"-"+e.y+pad(e.m)+pad(e.d)+".ics"); closeMenu(); });

      var gLink = document.createElement("a");
      gLink.className = "cal-opt"; gLink.setAttribute("role","menuitem");
      gLink.href = googleUrl(e); gLink.target = "_blank"; gLink.rel = "noopener noreferrer";
      gLink.innerHTML = CAL_ICON + '<span>Google Calendar</span>';
      gLink.addEventListener("click", function(){ closeMenu(); });

      menu.appendChild(icsBtn); menu.appendChild(gLink);

      btn.addEventListener("click", function(ev){
        ev.stopPropagation();
        var wasOpen = menu.classList.contains("open");
        closeMenu();
        if(!wasOpen){
          menu.classList.add("open"); btn.setAttribute("aria-expanded","true");
          var row = cell.parentElement;   // lift this week's row above later rows so the menu isn't painted over
          if(row){ row.style.zIndex = "30"; }
          openMenu = { menu:menu, btn:btn, row:row };
        }
      });

      cell.appendChild(menu);
      return cell;
    }

    // Public entry point: called with [{ date:"YYYY-MM-DD", start:<ms>, end:<ms> }] from the Apps Script.
    function renderSchedule(dateList){
      if(!groupsEl) return;
      var items = (Array.isArray(dateList) ? dateList : []).map(function(o){
        if(!o || !o.date) return null;
        var p = String(o.date).split("-");
        return { y:+p[0], m:+p[1], d:+p[2], date:o.date, start:+o.start, end:+o.end };
      }).filter(function(e){ return e && e.y && e.m && e.d && e.start && e.end; });
      items.sort(function(a,b){ return a.start - b.start; });

      var hm = items.length ? items[0].m : (new Date().getMonth() + 1);
      if(titleEl) titleEl.textContent = "Open in " + MONTH_FULL[hm-1];

      var nextItem = null;
      for(var i=0;i<items.length;i++){ if(!isPast(items[i])){ nextItem = items[i]; break; } }

      if(sectionEl) sectionEl.classList.remove("loading");   // swap loader -> content (note fades in via CSS)
      groupsEl.innerHTML = "";
      if(!items.length){
        if(noteEl) noteEl.textContent = "New dates dropping soon. check back!";
        return;
      }
      if(noteEl) noteEl.textContent = "Whisked with care, on the dates below.";

      function weekKey(e){
        var t = Date.UTC(e.y, e.m-1, e.d);
        var dow = new Date(t).getUTCDay();       // 0 Sun .. 6 Sat
        return t - ((dow + 6) % 7) * 86400000;   // ms of that week's Monday
      }
      var rows = [], cur = null;
      items.forEach(function(e){
        e.wd = new Date(e.y, e.m-1, e.d).getDay();
        var wk = weekKey(e);
        if(!cur || cur.wk !== wk){ cur = { wk:wk, list:[] }; rows.push(cur); }
        cur.list.push(e);
      });
      rows.forEach(function(row, ri){
        var wrap = document.createElement("div"); wrap.className = "dates";
        wrap.style.animationDelay = (ri * 0.07) + "s";   // gentle stagger, top row first
        row.list.forEach(function(e){ wrap.appendChild(makeChip(e, e === nextItem)); });
        groupsEl.appendChild(wrap);
      });
    }
    // Show last visit's dates instantly while the fresh ones load (fresh data re-renders on arrival)
    var CACHE_KEY = 'gm_dates_v3_' + outlet.id;
    try {
      var cachedDates = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cachedDates && Array.isArray(cachedDates.dates) && cachedDates.dates.length
          && Date.now() - cachedDates.at < 24*60*60*1000) {
        renderSchedule(cachedDates.dates);
      }
    } catch(e){}

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", function(e){ if(e.key === "Escape") closeMenu(); });
    // Dismiss any open menu on scroll (capture catches the closed-overlay scroll container too)
    window.addEventListener("scroll", closeMenu, true);

    return {
      render: function(dates){
        renderSchedule(dates);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), dates: dates })); } catch(e){}
      }
    };
  };

})();
