// ==UserScript==
// @name          MAP右クリ出兵
// @namespace     MIGIKURI
// @description   右クリックで出兵出来たら便利じゃん？
// @include       https://*.3gokushi.jp/*
// @include       http://*.3gokushi.jp/*
// @version       1.5
// @require       http://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js
// @resource  jqueryui_css   http://ajax.googleapis.com/ajax/libs/jqueryui/1.11.4/themes/smoothness/jquery-ui.css

// ==/UserScript==
// version	date
// 1.0		2022/08/22	開発開始
// 1.1		2022/08/25	β提供開始
// 1.2      2022/08/29  保護地マーク導入、マップ移動後に無効化される問題修正
// 1.3      2023/04/22  出兵完了後にマップへのチェックマーク、出兵メニューが閉じるよう修正
// 1.4      2023/05/08  big_map.phpの更新に伴う修正。地形に対応。旧5151がデフォルトマップになるよう修正
// 1.4      2023/05/08  出兵対象武将の選択方法をラジオボックス選択式 > 出兵ボタンから、各武将単位に出兵ボタンを設置するよう修正。
//                      殲滅と強襲で軌跡の色を分けるよう修正。
// マップの際際だとマップ表示処理が正常に動作しないバグ何とかしたいなぁ

// load jQuery
jQuery.noConflict();
j$ = jQuery;

//----------//
// 変数定義  //
//----------//
// ソフトウェアバージョン
var VERSION = "1.1";
var SERVER_NAME = location.hostname.match(/^(.*)\.3gokushi/)[1];
// 特殊定数
var SERVER_SCHEME = location.protocol + "//";
var BASE_URL = SERVER_SCHEME + location.hostname;
var PROTOCOL = location.protocol;
var HOST = location.hostname;        // アクセスURLホスト
var SERVICE = '';                    // サービス判定が必要な場合に使用する予約定数
var SVNAME = HOST.substr(0,location.hostname.indexOf(".")) + SERVICE;
var RST_KEY = "RST_" + HOST.substr(0,HOST.indexOf("."));
var AJAX_REQUEST_INTERVAL = 200;   // (ms)

// マップデータ保持用
var m_mapdata1 = [];
var RST_SETTING = 'rst_setting';  //設定保存

//----------------------
// メインルーチン
//----------------------
var deckIdList = [];
var unfocusedBaseList = [];
var html_l = "";
var busyoLength
(function() {
    //css定義を追加
    rst_addCss();
    var l_setting=rst_getValue(RST_KEY + '_' + RST_SETTING, "");
    linkRenew();
    //51*51マップの場合
    if (!(location.pathname.search('big_map.php') == -1) && location.search.indexOf('type=6') == -1){
        var baseList = j$("div[class='sideBoxInner basename'] ul a[href]").not('.map-basing');
        for (var i = 0; i < baseList.length; i++) {
            if(baseList[i].href.match(/village_id=(\d*)\D/)){
                unfocusedBaseList.push(baseList[i].href.match(/village_id=(\d*)\D/)[1]);
            }
        }
        console.log(unfocusedBaseList);


//----------------------------------------------------------------------
// 武将情報取得パート
//----------------------------------------------------------------------
	    // デッキページのhtml取得
	    j$.ajax({
	    	url: BASE_URL + '/card/deck.php',
	    	type: 'GET',
	    	datatype: 'html',
	    	cache: false
	    })
	    .done(function(res) {
	    	var resp = j$("<div>").append(res);
            // デッキ上の武将情報取得
            var cardinfo = j$("form[class='clearfix'] div[class='deck-all-card highlight-target']", resp);
            for (var i = 0; i < cardinfo.length; i++) {
                var cardName = j$("div[class='name-for-weather']", cardinfo.eq(i)).text().match(/\s*(\S*)\S*/)[1];
                var html = cardinfo.eq(i).html().replace(/[ \t\r\n]/g, "");
                var match = html.match(/(\d+)status_speed.*?(\d+)/);
                var hpcheck = j$("div[class='gageArea clearfix __deck_all'] div[class='hpArea']", cardinfo.eq(i)).text().match(/HP (\d+)\/\d+/)[1];
                var statuscheck = j$("div[class='state']", cardinfo.eq(i)).text().match(/(\t)+(.*)\n/)[2];
                var baseid = j$("div[class='village-name'] a[href]", cardinfo.eq(i)).attr('href').match(/village_id=(\d+)/)[1];
                if(match[2] > 300){
                    if(unfocusedBaseList.indexOf(baseid) == -1){
                        deckIdList.push({name: cardName, id: match[1], hp: hpcheck,  status: statuscheck, speed: match[2], from: baseid});
                    }
                }
            }
            // 速度順にソート
            deckIdList.sort(function(a,b){
                if(parseInt(a.speed) > parseInt(b.speed)) return -1;
                if(parseInt(a.speed) < parseInt(b.speed)) return 1;
                return 0;
            });
            // 選択用チェックボックスの作成
            busyoLength = deckIdList.length
			for (var i = 0; i < busyoLength; i++) {
				var gn = "";
                if(deckIdList[i].status == "待機中"){
                    gn = "<span style='color: red;'>" + deckIdList[i].name + "</span>";
                }else{
                    gn = "<span style='color: gray;'>" + deckIdList[i].name + "</span>";
                }

				html_l +=
					"<tr>" +
                        "<td><input type='button' id='1click_senmetsu_" + i + "' name='" + deckIdList[i].id + "' value='殲滅'></input></td>" +
                        "<td><input type='button' id='1click_kyosyu_" + i + "' name='" + deckIdList[i].id + "' value='強襲'></input></td>" +
							"<td> " + gn + "</td>" +
                            "<td> 速</td>" +
							"<td> " + deckIdList[i].speed + "</td>" +
							"<td> " + deckIdList[i].status + "</td>" +
					"</tr>";

			}
            rst_contextmenu2();
            // 保護期間中エリアの描画
            rst_remove_area2();
            // 等高線の描画
            reliefMap()
	    });
    }
})();

//---------------------
//   右クリックメニュー作成
//---------------------
function rst_contextmenu2(){
    j$(function(){
        j$('body').on('contextmenu',function(e){return false;});
    });
     //表示コンテナ作成
    var l_html = "<div class='rst_my-contextmenu' id='rst_js-contextmenu'><ul id='rst_action'><li><a href='javascript:void(0);'></a></li></ul></div>"
    var rst_facContainer = j$(l_html);
    j$("#change-map-scale2").after(rst_facContainer);
    var myContextMenu= new Object;
    j$("div[id=map51-content] ul li").each(function(index){
            j$(this).on('contextmenu', function(e){
                var l_match = j$(e.currentTarget).find('a').attr('href').match(/land.php\?x=([-]*\d+)&y=([-]*\d+)#ptop/);
                // 2023/05/28  big_map.phpの更新に伴う修正
                // var l_level = j$(e.currentTarget)[0].outerHTML.match(/.*<dd>(★*)<\/dd>*/);
                var l_level = j$(e.currentTarget)[0].outerHTML.match(/.*<dd>(★.*)\[\d\]<\/dd>*/);
                j$('#rst_action').append("<li>" +
                "<label style='margin-left: 3px;'>(" + l_match[1] + ", " + l_match[2] + ") ★" + l_level[1].length + "</label>" +
                "<table border='1' cellpadding='20'>" +
                html_l +
                "</table>" +
                "</li>");
                j$('#rst_action li:eq(0)').remove();

                myContextMenu = j$('#rst_js-contextmenu').get(0);
                var posX = e.clientX;
                var posY = e.clientY;
                myContextMenu.style.left = (posX + 18)+'px';
                myContextMenu.style.top = (posY + 18)+'px';
                myContextMenu.classList.add('show');
                console.log(l_match);

                for (var i = 0; i < busyoLength; i++) {
                    j$("#1click_senmetsu_" + i).on("click", async function(){
                        j$(this).prop("disabled", true); // クリック操作を禁止する

                        // sendTrooper関数をawaitで実行し、結果を受け取る
                        const result = await sendTrooper(j$(this).attr("name"), l_match[1], l_match[2], 302);

                        j$(this).prop("disabled", false); // クリック操作を再度許可する
                        j$(e.currentTarget).css('background', '#9400d3');
                        j$(e.currentTarget).addClass("focused-res");
                        j$(e.currentTarget).find('a').text('✓');
                        
                    });
                    j$("#1click_kyosyu_" + i).on("click", async function(){
                        j$(this).prop("disabled", true); // クリック操作を禁止する

                        // sendTrooper関数をawaitで実行し、結果を受け取る
                        const result = await sendTrooper(j$(this).attr("name"), l_match[1], l_match[2], 303);

                        j$(this).prop("disabled", false); // クリック操作を再度許可する
                        j$(e.currentTarget).css('background', '#6bff2f');
                        j$(e.currentTarget).addClass("focused-res");
                        j$(e.currentTarget).find('a').text('✓');
                        myContextMenu.classList.remove('show');
                    });
                }
            });
    });
}
//----------------------------------------------------------------------
// 出兵function
//----------------------------------------------------------------------
function sendTrooper(trooperId, troop_x, troop_y, battleType){
    return new Promise(function(resolve, reject) {
        // 送信データの作成
        var postdata = new Object;

        postdata['village_x_value'] = parseInt(troop_x);
        postdata['village_y_value'] = parseInt(troop_y);
        postdata['radio_move_type'] = battleType;        // 強襲か殲滅か
        postdata['show_beat_bandit_flg'] = 1;
        postdata['radio_reserve_type'] = 0;
        postdata['card_id'] = 204;
        postdata['btn_send'] = '出兵';

        // 出兵処理
        var wait = false;
        var timer1 = setInterval(
            function() {
                if (wait) {
                    return;
                }
                wait = true;

                // 出兵する武将カード
                postdata['unit_assign_card_id'] = trooperId;
                console.log(postdata);

                // 武将出兵命令クエリをPOSTする
                j$.ajax({
                    url: BASE_URL + "/facility/castle_send_troop.php",
                    type: 'POST',
                    datatype: 'html',
                    cache: false,
                    data: postdata
                })
                .done(function(res){
                    clearInterval(timer1);
                    timer1 = null;
                    wait = false;
                    resolve(res); // レスポンスをresolveする
                })
                .fail(function(jqXHR, textStatus, errorThrown){
                    clearInterval(timer1);
                    timer1 = null;
                    wait = false;
                    reject(errorThrown); // エラーをrejectする
                });
            }, AJAX_REQUEST_INTERVAL
        );
    });
}

    //---------------------
    //   保護期間中領地
    //---------------------
    function rst_remove_area2(){
        j$("div[id=map51-content] ul li").each(function(index){
            if ((j$(this).find('a').attr('onmouseover').indexOf("保護期間中"))!=-1){
                j$(this).addClass("focused-res");
                j$(this).find('a').text('⚫︎');
               j$(this).css('background', '#000000');
            }
        });
    }


    // 2023/05/08  地形に対応
    //---------------------
    //   地形
    //---------------------
    function reliefMap(){
        j$("div[id=map51-content] ul li").each(function(index){
            if ((j$(this).find('a').attr('onmouseover').indexOf("平地"))!=-1){
                j$(this).addClass("focused-res");
                j$(this).css({
                    //'border': '1px solid #fff',
                    //'border-top-width': '-1px',
                    //'box-sizing': 'border-box'
                    'border': 'none',
                    'outline': 'none',
                    'outline': '3px solid #fff',
                    'outline-offset': '-1px'
                });
            }
            if ((j$(this).find('a').attr('onmouseover').indexOf("低地"))!=-1){
                j$(this).addClass("focused-res");
                j$(this).css({
                    //'border': '1px solid  #dfe5ed',
                    //'border-top-width': '-1px',
                    //'box-sizing': 'border-box'
                    'border': 'none',
                    'outline': 'none',
                    'outline': '3px solid  #dfe5ed',
                    'outline-offset': '-1px'
                });
            }
            if ((j$(this).find('a').attr('onmouseover').indexOf("高地"))!=-1){
                j$(this).addClass("focused-res");
                j$(this).css({
                    //'border': '1px solid #c2c28e',
                    //'border-top-width': '1px',
                    //'box-sizing': 'border-box'
                    'border': 'none',
                    'outline': 'none',
                    'outline': '3px solid #c2c28e',
                    'outline-offset': '-1px'
                });
            }
            if ((j$(this).find('a').attr('onmouseover').indexOf("山地"))!=-1){
                j$(this).addClass("focused-res");
                j$(this).css({
                    //'border': '1px solid #ad8467',
                    //'border-top-width': '1px',
                    //'box-sizing': 'border-box'
                    'border': 'none',
                    'outline': 'none',
                    'outline': '3px solid #ad8467',
                    'outline-offset': '-1px'
                });
            }
        });
    }
    // 2023/05/08  旧5151がデフォルトマップになるよう修正
    //---------------------
    //   マップ新UI無効化t
    //---------------------
    function linkRenew(){
        console.log("linkRenewed");
        // j$('a[href*="/map.php"]').attr('href', '/big_map.php?type=4');
        
       
    }
//---------------//
// css定義の追加 //
//---------------//
function rst_addCss() {
    var css =" \
    .rst_removemark { \
        text-decoration: line-through; \
    }\
    .rst_my-contextmenu {\
        -moz-border-radius:3px;\
        border-radius: 3px; \
        -webkit-border-radius: 3px; \
        display: none;\
        position: fixed;\
        background-color: #fff;\
        border: 2px solid #ccc;\
        box-shadow: 1px 1px 1px rgba(0,0,0,.2);\
        z-index:9999; \
    }\
    .rst_my-contextmenu.show {\
        display: block;\
    }\
    .rst_my-contextmenu ul {\
        list-style: none;\
        padding: 10px 0;\
    }\
    .rst_my-contextmenu ul li a {\
        padding: 4px 10px;\
        font-size: 14px;\
        color: #333;\
    }\
    ";
    rst_addGlobalStyle(css);
}
function rst_addGlobalStyle(css) {
    var head, style;
    head = document.getElementsByTagName('head')[0];
    if (!head) { return; }
    style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = css;
    head.appendChild(style);
}
function rst_setValue(name, value) {
    value = (typeof value)[0] + value;
    localStorage.setItem(name, value);
}
function rst_getValue(name, defaultvalue) {
    var value = localStorage.getItem(name);
    if (!value) return defaultvalue;
    var type = value[0];
    value = value.substring(1);
    switch (type) {
    case 'b':
        return value == 'true';
    case 'n':
        return Number(value);
    default:
        return value;
    }
}
