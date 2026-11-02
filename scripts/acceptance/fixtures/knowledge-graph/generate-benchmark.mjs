import console from "node:console"
import { readFileSync, writeFileSync } from "node:fs"
import process from "node:process"
import { fileURLToPath, URL } from "node:url"

import { validateBenchmark } from "../../lib/knowledge-graph-evaluation.mjs"

// Every passage and question is authored below. This only resolves explicit passage
// references and serializes them; it does not generate paraphrases or inferred labels.
const authoredBooks = [
  {
    book_id: "reed-canal",
    title: "苇渠夜汛",
    split: "development",
    chapters: [
      { heading: "旧水尺", passages: {
        scene: "入汛前，苇镇的旧渠堵了。镇里决定先修渠，再开水市，沿途的人和物都记进巡渠簿。",
        alias: "绘渠人沈砚，镇上人叫他阿砚；石匠沈雁与沈砚同音，却是两个人。",
        token: "沈砚把唯一一枚铜鱼令交给守闸人罗禾，约定铜鱼令只作开闸凭证，不代表水田归属。",
        gauge: "渠口的旧水尺有十二格，红线画在第九格。",
        quote: "罗禾念出闸规的四字口令：先听后开。",
      } },
      { heading: "白鹭渡", passages: {
        route: "巡渠簿记载：白鹭渡通往柳仓。",
        steward: "柳仓的管事是许槐。",
        ropes: "许槐清点仓中麻绳，共有七捆。",
        transfer: "罗禾把铜鱼令交给许槐，让她去北闸领修闸木料；此后罗禾身上没有铜鱼令。",
        distinction: "石匠沈雁修的是渡口石阶，没有参加绘渠。",
      } },
      { heading: "北闸收据", passages: {
        keeper: "许槐把铜鱼令交给北闸值守陆汀，陆汀收下后一直带在腰间。",
        gate: "陆汀只负责北闸的值守。",
        drain: "北闸泄下的水只流入蒲塘。",
        boat: "运木船叫青梭，船长是陶七。",
        receipt: "陶七交来六根杉木，陆汀在收据上写下六字：木到再拆旧梁。",
      } },
      { heading: "断绳", passages: {
        loss: "柳仓原有的七捆麻绳中，有两捆被雨水泡坏，许槐把这两捆划出可用账。",
        purchase: "同日傍晚，许槐又买入三捆完好麻绳，全部入柳仓；当天再没有麻绳进出。",
        oil: "沈雁用一罐桐油涂完了渡口的新扶手。",
        rumor: "茶摊有人传言蒲塘下面埋着银箱，但说话的人没有下过塘，也拿不出见证。",
      } },
      { heading: "退令", passages: {
        return: "北闸收料结束，陆汀当面把铜鱼令还给沈砚；铜鱼令此后由沈砚随身保管。",
        appointment: "巡渠簿指定陶七担任应急信使。",
        contact: "应急信使须向药铺掌柜问取汛时敲钟人。",
        shop: "苇镇唯一的药铺掌柜是杜蘅。",
        noOil: "许槐只付了绳钱，没有经手石阶用的桐油。",
      } },
      { heading: "急水", passages: {
        bell: "杜蘅告诉来人：汛时敲钟人是梅九。",
        tower: "梅九值守的钟楼在桑堤。",
        flood: "夜里水尺升到第十格，越过了第九格的红线。",
        order: "沈砚给罗禾的急条只有六字：先疏东沟后闸。",
        intention: "沈雁说天亮后打算去蒲塘捞起旧石狮，此时尚未动身。",
      } },
      { heading: "新木匣", passages: {
        custody: "沈砚把铜鱼令交给梅九保管，梅九当场收进自己的木匣，此后未再转交。",
        label: "梅九的木匣标签写着守潮匣。",
        clearing: "罗禾照急条先疏通东沟，再去开闸；退下的水没有漫进柳仓。",
        labor: "疏沟队原有五人，许槐又派来两人；收工前没人离队。",
      } },
      { heading: "水市重开", passages: {
        final: "水市开张时，铜鱼令仍在梅九的守潮匣里；沈砚空着双手来核对巡渠簿。",
        correction: "巡渠簿把石阶修补者正式记为沈雁，把渠图作者记为沈砚。",
        depth: "退水后的水尺停在第六格。",
        outcome: "柳仓的麻绳封存到水市开张，没有再领用或补入。",
        closing: "罗禾说，渠通了也要留着旧收据。陶七把青梭系回白鹭渡，等下一次送信。",
      } },
    ],
    cases: [
      ["alias", "alias", 1, "阿砚的本名是什么？只答姓名。", "沈砚", [["1.alias"]]],
      ["homophone", "homonym", 2, "与绘渠人姓名同音、负责修渡口石阶的人是谁？", "沈雁", [["1.alias", "2.distinction"]]],
      ["origin-owner", "historical_state", 1, "第一章交接结束后，铜鱼令由谁持有？", "罗禾", [["1.token"]]],
      ["second-owner", "state_update", 2, "第二章结束时，铜鱼令由谁持有？", "许槐", [["2.transfer"]]],
      ["third-owner", "state_update", 3, "第三章结束时，铜鱼令由谁持有？", "陆汀", [["3.keeper"]]],
      ["returned-owner", "state_update", 5, "第五章收料结束退令后，铜鱼令由谁持有？", "沈砚", [["5.return"]]],
      ["final-owner", "state_update", 8, "水市开张时，铜鱼令由谁保管？", "梅九", [["8.final"]], [["7.custody"]]],
      ["past-owner", "historical_state", 8, "读完第八章回看，铜鱼令还给绘渠人之前，是谁在北闸保管它？", "陆汀", [["3.keeper", "5.return"]]],
      ["gauge", "quantity", 1, "旧水尺共有多少格？只答阿拉伯数字。", "12", [["1.gauge"]]],
      ["redline", "single_hop", 1, "旧水尺的红线在第几格？只答阿拉伯数字。", "9", [["1.gauge"]]],
      ["password", "quote", 1, "罗禾念出的四字闸规口令是什么？不要加引号和标点。", "先听后开", [["1.quote"]]],
      ["ferry-steward", "multi_hop", 2, "白鹭渡通往的仓库由谁管事？", "许槐", [["2.route", "2.steward"]]],
      ["ferry-ropes", "multi_hop", 2, "第二章，白鹭渡通往的仓库有多少捆麻绳？只答阿拉伯数字。", "7", [["2.route", "2.ropes"]]],
      ["keeper-water", "multi_hop", 3, "第三章铜鱼令持有人负责的闸，泄水只流入哪里？", "蒲塘", [["3.keeper", "3.gate", "3.drain"]]],
      ["alias-water", "multi_hop", 3, "阿砚最初把铜鱼令交给的人，后来把令交给了谁？", "许槐", [["1.alias", "1.token", "2.transfer"]]],
      ["boat-captain", "single_hop", 3, "运木船青梭的船长是谁？", "陶七", [["3.boat"]]],
      ["wood-count", "quantity", 3, "陶七交来了多少根杉木？只答阿拉伯数字。", "6", [["3.receipt"]]],
      ["receipt", "quote", 3, "陆汀在收据上写下的六个字是什么？不要加标点。", "木到再拆旧梁", [["3.receipt"]]],
      ["usable-ropes", "quantity_reasoning", 4, "第四章结束时，柳仓共有多少捆可用麻绳？只答阿拉伯数字。", "8", [["2.ropes", "4.loss", "4.purchase"]]],
      ["oil-worker", "single_hop", 4, "谁用桐油涂了渡口的新扶手？", "沈雁", [["4.oil"]]],
      ["messenger", "single_hop", 5, "巡渠簿指定的应急信使是谁？", "陶七", [["5.appointment"]]],
      ["captain-contact", "multi_hop", 5, "青梭的船长以应急信使身份找谁问敲钟人？只答掌柜姓名。", "杜蘅", [["3.boat", "5.appointment", "5.contact", "5.shop"]]],
      ["messenger-bell", "multi_hop", 6, "巡渠簿指定的信使需要问取的汛时敲钟人是谁？", "梅九", [["5.appointment", "5.contact", "5.shop", "6.bell"]]],
      ["shop-tower", "multi_hop", 6, "药铺掌柜指出的敲钟人，在何处的钟楼值守？", "桑堤", [["5.shop", "6.bell", "6.tower"]]],
      ["flood-gap", "quantity_reasoning", 6, "急水夜里，水尺比红线高了几格？只答阿拉伯数字。", "1", [["1.gauge", "6.flood"]]],
      ["urgent-note", "quote", 6, "沈砚给罗禾的急条是哪六个字？不要加标点。", "先疏东沟后闸", [["6.order"]]],
      ["current-container", "multi_hop", 7, "第七章新接收铜鱼令的人，把令放进了标签为何的匣子？", "守潮匣", [["7.custody", "7.label"]]],
      ["bell-holder-place", "multi_hop", 7, "第七章铜鱼令保管人值守的钟楼在哪里？", "桑堤", [["7.custody", "6.tower"]]],
      ["sequence-first", "event_order", 7, "罗禾开闸前先疏通的是哪条沟？", "东沟", [["7.clearing"]]],
      ["workers", "quantity_reasoning", 7, "收工前疏沟队一共有多少人？只答阿拉伯数字。", "7", [["7.labor"]]],
      ["map-author", "identity", 8, "正式巡渠簿记载的渠图作者是谁？", "沈砚", [["8.correction"]]],
      ["final-depth", "quantity", 8, "退水后水尺停在第几格？只答阿拉伯数字。", "6", [["8.depth"]]],
      ["final-ropes", "historical_state", 8, "水市开张时柳仓仍封存着多少捆可用麻绳？只答阿拉伯数字。", "8", [["2.ropes", "4.loss", "4.purchase", "8.outcome"]]],
      ["planned-target", "epistemic_status", 6, "沈雁说天亮后打算到蒲塘捞起什么？只答物名。", "旧石狮", [["6.intention"]]],
      ["unknown-surname", "unknown", 8, "罗禾的母亲叫什么名字？", null, []],
      ["unknown-price", "unknown", 8, "许槐买三捆麻绳一共付了多少文钱？", null, []],
      ["unknown-silver", "unknown", 4, "据已核实事实，蒲塘底下的银箱重多少斤？", null, []],
      ["unknown-salvage", "unknown", 6, "截至第六章，沈雁实际把旧石狮捞上岸用了几人？", null, []],
      ["unknown-future", "unknown", 2, "截至第二章，水市开张那天铜鱼令会由谁保管？", null, []],
      ["unknown-material", "unknown", 8, "守潮匣用的是什么树种的木料？", null, []],
    ],
  },
  {
    book_id: "orbital-seed",
    title: "环站种匣",
    split: "development",
    chapters: [
      { heading: "隔离舱来客", passages: {
        scene: "环站迎来一批耐寒种子。站员要在停电演练前完成隔离、检验和移交，所有交接按舱日记次序登记。",
        alias: "检验员纪澄的呼号是小满；驾驶员季橙与纪澄姓名同音，是另一名站员。",
        crate: "工程师燕书把唯一的白瓷种匣交给纪澄，匣中装着试验批次霜七。",
        amount: "入站清单记载霜七共有二十四粒种子。",
        motto: "纪澄在隔离牌上写下四字提醒：先检后播。",
      } },
      { heading: "走廊两端", passages: {
        lab: "呼号小满的站员在白鸥实验室工作。",
        zone: "白鸥实验室位于乙环。",
        power: "乙环由三号电池组单独供电。",
        duplicate: "季橙只驾驶巡检艇回声，不做种子检验。",
        transfer: "纪澄把白瓷种匣交给保管员闻桥，供他安排隔离柜。",
      } },
      { heading: "柜门结霜", passages: {
        storage: "闻桥把白瓷种匣锁进蓝柜，自此匣子没有离开蓝柜，直到本日结束。",
        key: "蓝柜唯一的钥匙由护士林默保管。",
        failed: "检验从霜七中剔出了五粒破损种子，破损粒封入废样袋。",
        count: "剔除以后没有补入种子，霜七的完好粒全部留在白瓷种匣。",
        quote: "闻桥在交接屏输入六个字：柜冷不等于漏。",
      } },
      { heading: "小窗试播", passages: {
        removal: "林默当着闻桥的面开启蓝柜，从白瓷种匣取出六粒完好种子试播，取后锁好柜门。",
        tray: "当日的口头记录说：这六粒种子全部种进二号育苗盘，没有分到别处。",
        lamps: "二号育苗盘由四盏冷灯照明。",
        rumor: "有人说霜七能在真空里发芽，纪澄把这句话标为未验证传闻，站上没有做真空试验。",
      } },
      { heading: "红柜移交", passages: {
        move: "闻桥从蓝柜取出白瓷种匣，正式交给值班官苏岑保管；苏岑把它锁进红柜。",
        key: "红柜唯一的钥匙交给季橙，季橙没有取得蓝柜钥匙。",
        return: "二号育苗盘的六粒中有两粒尚未播入土中，林默将这两粒原样退回白瓷种匣；其余四粒继续留盘。",
        clarity: "舱日记更正了上一日的口头记录：所谓全部种进育苗盘，只是六粒送入盘区，并非全已入土。",
        channel: "值班官的紧急消息须发给信号员。",
      } },
      { heading: "停电演练", passages: {
        signal: "环站唯一的信号员是何早。",
        beacon: "何早负责的应急信标叫归星。",
        relay: "归星的接收端只设在青湾站。",
        outage: "演练切断了三号电池组，乙环因此断电；甲环仍由一号电池组供电。",
        order: "苏岑发出的演练指令是六个字：先护幼苗后灯。",
      } },
      { heading: "密封袋", passages: {
        final: "苏岑把白瓷种匣连同保管责任交还给燕书，燕书将种匣装入银色密封袋，随身带到演练结束。",
        seals: "银色密封袋只有一道蜡封，蜡封编号为丙九。",
        registry: "霜七没有再增减种子：退回的两粒与原匣完好粒同存，四粒留盘，五粒破损封袋。",
        delayed: "季橙提出明日把红柜改装成工具柜，但改装尚未开始。",
      } },
      { heading: "灯复明", passages: {
        confirm: "演练结束，燕书仍随身保管装有白瓷种匣的银色密封袋；袋上的丙九蜡封完好。",
        germinate: "二号育苗盘留下的四粒种子里，有三粒发芽，一粒仍无芽；当天没有移栽。",
        schedule: "甲环恢复例行巡检，季橙驾驶回声出发。纪澄则留在白鸥实验室核对废样袋。",
        closing: "何早收到了青湾站的回执，但舱日记没有记下回执用时。大家等到封条复查完才离舱。",
      } },
    ],
    cases: [
      ["alias", "alias", 1, "呼号小满的检验员本名是什么？", "纪澄", [["1.alias"]]],
      ["homophone", "homonym", 2, "与纪澄姓名同音、驾驶回声的站员是谁？", "季橙", [["1.alias", "2.duplicate"]]],
      ["initial-owner", "historical_state", 1, "第一章交接后，白瓷种匣由谁持有？", "纪澄", [["1.crate"]]],
      ["second-owner", "state_update", 2, "第二章结束时，白瓷种匣交给谁保管？", "闻桥", [["2.transfer"]]],
      ["blue-storage", "state_update", 3, "第三章结束时，白瓷种匣锁在哪个柜子？", "蓝柜", [["3.storage"]]],
      ["red-owner", "state_update", 5, "第五章正式移交后，白瓷种匣由谁保管？", "苏岑", [["5.move"]]],
      ["final-owner", "state_update", 8, "演练结束时白瓷种匣由谁保管？", "燕书", [["8.confirm"]], [["7.final"]]],
      ["past-blue-owner", "historical_state", 8, "回看第五章，交给值班官之前，是谁从蓝柜取出白瓷种匣？", "闻桥", [["5.move"]]],
      ["batch", "single_hop", 1, "白瓷种匣入站时装的是哪个试验批次？", "霜七", [["1.crate"]]],
      ["initial-count", "quantity", 1, "入站时霜七有多少粒种子？只答阿拉伯数字。", "24", [["1.amount"]]],
      ["motto", "quote", 1, "隔离牌的四字提醒是什么？不要加标点。", "先检后播", [["1.motto"]]],
      ["alias-lab", "multi_hop", 2, "纪澄在哪个实验室工作？", "白鸥实验室", [["1.alias", "2.lab"]]],
      ["alias-zone", "multi_hop", 2, "纪澄工作的实验室位于哪个环区？", "乙环", [["1.alias", "2.lab", "2.zone"]]],
      ["alias-power", "multi_hop", 2, "纪澄工作的实验室所在环区由哪个电池组单独供电？", "三号电池组", [["1.alias", "2.lab", "2.zone", "2.power"]]],
      ["pilot-vehicle", "single_hop", 2, "季橙驾驶的巡检艇叫什么？", "回声", [["2.duplicate"]]],
      ["blue-key", "single_hop", 3, "蓝柜唯一的钥匙由谁保管？", "林默", [["3.key"]]],
      ["owner-key", "multi_hop", 3, "第三章种匣所处柜子的唯一钥匙由谁保管？", "林默", [["3.storage", "3.key"]]],
      ["intact-count", "quantity_reasoning", 3, "剔除破损粒后霜七剩多少粒完好种子？只答阿拉伯数字。", "19", [["1.amount", "3.failed", "3.count"]]],
      ["handoff-quote", "quote", 3, "闻桥输入交接屏的六个字是什么？不要加标点。", "柜冷不等于漏", [["3.quote"]]],
      ["trial-count", "quantity", 4, "第四章林默从种匣取出多少粒试播种子？只答阿拉伯数字。", "6", [["4.removal"]]],
      ["remaining-at-four", "quantity_reasoning", 4, "第四章取出试播粒并锁柜后，白瓷种匣还剩多少粒完好种子？只答阿拉伯数字。", "13", [["1.amount", "3.failed", "3.count", "4.removal"]]],
      ["keyholder-tray", "multi_hop", 4, "蓝柜钥匙保管人取出的六粒种子送到了哪个育苗盘？", "二号育苗盘", [["3.key", "4.removal", "4.tray"]]],
      ["trial-lamps", "multi_hop", 4, "试播六粒种子所用育苗盘有几盏照明冷灯？只答阿拉伯数字。", "4", [["4.tray", "4.lamps"]]],
      ["red-key", "single_hop", 5, "红柜唯一的钥匙由谁持有？", "季橙", [["5.key"]]],
      ["homophone-key", "multi_hop", 5, "与小满本名同音的另一名站员，在第五章取得了哪个柜子的钥匙？", "红柜", [["1.alias", "5.key"]]],
      ["returned-count", "quantity_reasoning", 5, "第五章退回两粒后，白瓷种匣中有多少粒完好种子？只答阿拉伯数字。", "15", [["1.amount", "3.failed", "4.removal", "5.return"]]],
      ["officer-signal", "multi_hop", 6, "第五章接收种匣的值班官，紧急消息应发给谁？", "何早", [["5.move", "5.channel", "6.signal"]]],
      ["signal-beacon", "multi_hop", 6, "环站唯一信号员负责的应急信标叫什么？", "归星", [["6.signal", "6.beacon"]]],
      ["officer-receiver", "multi_hop", 6, "值班官的紧急消息经信号员所管信标发送，唯一接收端在哪个站？", "青湾站", [["5.channel", "6.signal", "6.beacon", "6.relay"]]],
      ["outage-zone", "event_order", 6, "演练切断三号电池组后，哪个环区因此断电？", "乙环", [["6.outage"]]],
      ["exercise-quote", "quote", 6, "苏岑发出的六字演练指令是什么？不要加标点。", "先护幼苗后灯", [["6.order"]]],
      ["final-seal", "multi_hop", 7, "第七章种匣被装入的袋子，蜡封编号是什么？", "丙九", [["7.final", "7.seals"]]],
      ["germination", "quantity", 8, "二号育苗盘共有几粒种子发芽？只答阿拉伯数字。", "3", [["8.germinate"]]],
      ["record-correction", "epistemic_status", 5, "第五章更正后，取出试播的六粒中实际继续留盘的有几粒？只答阿拉伯数字。", "4", [["5.clarity", "5.return"]]],
      ["unknown-origin", "unknown", 8, "霜七采自哪颗行星？", null, []],
      ["unknown-vacuum", "unknown", 4, "根据已完成的试验，霜七在真空中发芽需几小时？", null, []],
      ["unknown-future", "unknown", 2, "截至第二章，演练结束时白瓷种匣会由谁保管？", null, []],
      ["unknown-conversion", "unknown", 7, "截至第七章，季橙计划改装红柜需要几小时？", null, []],
      ["unknown-transmission", "unknown", 8, "青湾站回执传回环站用了几秒？", null, []],
      ["unknown-relative", "unknown", 8, "林默的弟弟叫什么名字？", null, []],
    ],
  },
  {
    book_id: "shadow-stage",
    title: "雨棚下的影戏",
    split: "holdout",
    chapters: [
      { heading: "入镇", passages: {
        scene: "流动影戏班到松港演出。雨棚要搭三夜，班里把旧戏本、入场券和临时场地分别记账，以免散场时混在一起。",
        alias: "操影师闻笛的艺名是竹声；裱画人文迪与闻笛姓名同音，是专为戏班修画的另一人。",
        score: "班主邵宁把孤本戏谱《渡月》交给闻笛，声明原件只此一册。",
        tickets: "戏班入镇时带来四十张纸券。",
        line: "闻笛把开场念白定为四个字：借光问路。",
      } },
      { heading: "修画铺", passages: {
        shop: "文迪经营的铺子叫听雨斋。",
        lane: "听雨斋开在石榴巷。",
        master: "石榴巷的夜间巡巷人是关芦。",
        transfer: "闻笛把《渡月》原件交给学徒余弦，让余弦照谱排练。",
        distinction: "文迪只修补旧幕布上的画，不登台操影。",
      } },
      { heading: "三处约定", passages: {
        stage: "本次《渡月》的正式演出场地定为盐亭。",
        custodian: "盐亭的场地管理员是乔叶。",
        bell: "乔叶负责保管唯一的开场铃。",
        tickets: "邵宁从四十张纸券中售出十三张；当日没有赠券、补印或退票。",
        quote: "余弦在排练页边抄了六个字：影到人声才起。",
      } },
      { heading: "借谱", passages: {
        transfer: "余弦把《渡月》原件交给鼓师苏简，请他核对鼓点；苏简收下后锁在鼓箱。",
        owner: "苏简的鼓箱外贴着小篆纸签，纸签写着听潮箱。",
        rumor: "巷里有人说旧戏谱夹着藏宝图，余弦没有翻到，其他人也没有见过。",
        weather: "当夜漏雨，文迪在听雨斋替幕布补了三处破口。",
      } },
      { heading: "移棚", passages: {
        relocation: "盐亭屋顶漏雨，班主把《渡月》的正式演出场地改为榕院，盐亭安排取消。",
        manager: "榕院的场地管理员是孟照，孟照不负责盐亭。",
        return: "苏简核完鼓点，将《渡月》原件还给邵宁，邵宁收进随身布包，此后直到本章结束未再交出。",
        refund: "此前售出的十三张纸券中，有四张退票，戏班将四张退回的券全部撕毁；没有新售或补印。",
        intention: "余弦提出演完后把戏谱抄给学堂，但此刻一个字也没抄。",
      } },
      { heading: "传话人", passages: {
        rule: "正式演出场地的管理员负责把开场时刻传给送信人。",
        messenger: "戏班指定的送信人是船娘唐汐。",
        ferry: "唐汐用来送信的船叫晚芦。",
        berth: "晚芦固定停靠在乌桥。",
        note: "孟照收到班主的六字条子：先验绳再挂幕。",
      } },
      { heading: "新保管人", passages: {
        handoff: "邵宁将《渡月》原件交给文迪临时保管，文迪把它收入听雨斋的漆匣；到散场前原件都没有离匣。",
        label: "听雨斋漆匣的匣盖写着双鹤。",
        lamps: "榕院原有三盏台灯，乔叶从盐亭借来两盏；当晚五盏都亮着。",
        sale: "当晚又售出八张入镇时带来的纸券，演出开始前没有其他售票、赠券、退票或补印。",
      } },
      { heading: "散场", passages: {
        final: "散场清点，《渡月》原件仍由文迪保管，封在听雨斋的双鹤漆匣内；邵宁只带走自己的布包。",
        performance: "《渡月》按改后的安排在榕院演完，操影的是竹声，余弦在台侧翻排练页。",
        copy: "散场时学堂仍未收到抄本，余弦也没有开始抄谱。",
        closing: "唐汐把晚芦系牢，关芦巡过石榴巷。戏班等幕布晾干再启程，没有记下下一个镇子的名字。",
      } },
    ],
    cases: [
      ["alias", "alias", 1, "艺名竹声的操影师本名是什么？", "闻笛", [["1.alias"]]],
      ["homophone", "homonym", 2, "与闻笛姓名同音、经营修画铺的人是谁？", "文迪", [["1.alias", "2.shop"]]],
      ["first-owner", "historical_state", 1, "第一章班主交谱后，《渡月》原件由谁持有？", "闻笛", [["1.score"]]],
      ["second-owner", "state_update", 2, "第二章结束时，《渡月》原件由谁拿着排练？", "余弦", [["2.transfer"]]],
      ["third-owner", "state_update", 4, "第四章核对鼓点时，《渡月》原件由谁持有？", "苏简", [["4.transfer"]]],
      ["returned-owner", "state_update", 5, "第五章结束时，《渡月》原件由谁保管？", "邵宁", [["5.return"]]],
      ["final-owner", "state_update", 8, "散场清点时，《渡月》原件由谁保管？", "文迪", [["8.final"]], [["7.handoff"]]],
      ["historical-holder", "historical_state", 8, "回看原件退还班主之前，为核对鼓点而保管原件的是谁？", "苏简", [["4.transfer", "5.return"]]],
      ["tickets-initial", "quantity", 1, "入镇时戏班带来多少张纸券？只答阿拉伯数字。", "40", [["1.tickets"]]],
      ["opening", "quote", 1, "《渡月》的四字开场念白是什么？不要加标点。", "借光问路", [["1.line"]]],
      ["alias-first-giver", "multi_hop", 2, "竹声把《渡月》原件交给了哪名学徒？", "余弦", [["1.alias", "2.transfer"]]],
      ["homophone-lane", "multi_hop", 2, "与闻笛同音的裱画人，其铺子开在哪条巷子？", "石榴巷", [["1.alias", "2.shop", "2.lane"]]],
      ["shop-patrol", "multi_hop", 2, "文迪的铺子所在巷子，由谁夜间巡查？", "关芦", [["2.shop", "2.lane", "2.master"]]],
      ["old-stage", "historical_state", 3, "第三章确定的《渡月》正式演出场地是哪里？", "盐亭", [["3.stage"]]],
      ["stage-custodian", "multi_hop", 3, "第三章所定演出场地的管理员是谁？", "乔叶", [["3.stage", "3.custodian"]]],
      ["stage-bell", "multi_hop", 3, "第三章所定场地的管理员保管着哪件唯一的开场器物？", "开场铃", [["3.stage", "3.custodian", "3.bell"]]],
      ["unsold-at-three", "quantity_reasoning", 3, "第三章售票后尚未售出的纸券有多少张？只答阿拉伯数字。", "27", [["1.tickets", "3.tickets"]]],
      ["margin", "quote", 3, "余弦抄在排练页边的六个字是什么？不要加标点。", "影到人声才起", [["3.quote"]]],
      ["drum-label", "multi_hop", 4, "第四章存放《渡月》原件的鼓箱，纸签写着什么？", "听潮箱", [["4.transfer", "4.owner"]]],
      ["patches", "quantity", 4, "漏雨当夜，文迪补了幕布多少处破口？只答阿拉伯数字。", "3", [["4.weather"]]],
      ["new-stage", "state_update", 5, "第五章改定的《渡月》正式演出场地在哪里？", "榕院", [["5.relocation"]]],
      ["new-manager", "multi_hop", 5, "改定的正式演出场地由谁管理？", "孟照", [["5.relocation", "5.manager"]]],
      ["retrospective-stage", "historical_state", 8, "读完第八章回看，漏雨改场之前原定在哪里演出《渡月》？", "盐亭", [["3.stage", "5.relocation"]]],
      ["valid-sold", "quantity_reasoning", 5, "第五章退票完成后，尚未退票的已售纸券有多少张？只答阿拉伯数字。", "9", [["3.tickets", "5.refund"]]],
      ["new-message-sender", "multi_hop", 6, "按第六章传话规则，改场后应由谁把开场时刻传给送信人？", "孟照", [["5.relocation", "5.manager", "6.rule"]]],
      ["message-boat", "multi_hop", 6, "正式场地管理员传给送信人的消息，会由哪条船运送？", "晚芦", [["6.rule", "6.messenger", "6.ferry"]]],
      ["message-berth", "multi_hop", 6, "正式场地管理员要找送信人的船，可到哪个固定停靠处？", "乌桥", [["6.rule", "6.messenger", "6.ferry", "6.berth"]]],
      ["safety-note", "quote", 6, "班主给孟照的六字条子写了什么？不要加标点。", "先验绳再挂幕", [["6.note"]]],
      ["new-custody-lane", "multi_hop", 7, "第七章原件新保管人所开的铺子在哪条巷子？", "石榴巷", [["7.handoff", "2.lane"]]],
      ["case-label", "multi_hop", 7, "第七章放入《渡月》原件的漆匣，匣盖写着什么？", "双鹤", [["7.handoff", "7.label"]]],
      ["lamps", "quantity_reasoning", 7, "榕院当晚亮着多少盏台灯？只答阿拉伯数字。", "5", [["7.lamps"]]],
      ["audience-tickets", "quantity_reasoning", 7, "第七章演出开始前，累计未退票的已售纸券有多少张？只答阿拉伯数字。", "17", [["3.tickets", "5.refund", "7.sale"]]],
      ["unissued-tickets", "quantity_reasoning", 7, "扣除已售和撕毁的退回券，第七章售票结束时尚未售出的纸券有多少张？只答阿拉伯数字。", "19", [["1.tickets", "3.tickets", "5.refund", "7.sale"]]],
      ["performer", "multi_hop", 8, "第八章在榕院正式操影的人本名是什么？", "闻笛", [["8.performance", "1.alias"]]],
      ["unknown-destination", "unknown", 8, "戏班离开松港后要去的下一个镇子叫什么？", null, []],
      ["unknown-treasure", "unknown", 4, "根据已核实事实，《渡月》夹着的藏宝图指向哪座山？", null, []],
      ["unknown-future", "unknown", 2, "截至第二章，《渡月》最终会在哪个场地正式演完？", null, []],
      ["unknown-copy", "unknown", 8, "余弦计划交给学堂的抄本总共要抄多少页？", null, []],
      ["unknown-price", "unknown", 8, "每张纸券的票价是多少文钱？", null, []],
      ["unknown-family", "unknown", 8, "乔叶的父亲叫什么名字？", null, []],
    ],
  },
]

function expandBook(book) {
  const passages = new Map()
  const chapters = book.chapters.map(({ heading, passages: authored }, index) => {
    const source_key = `${book.book_id}-chapter-${String(index + 1).padStart(2, "0")}-v1`
    for (const [name, quote] of Object.entries(authored)) {
      passages.set(`${index + 1}.${name}`, { source_key, quote })
    }
    return { source_key, sequence: index + 1, heading, body: Object.values(authored).join("\n") }
  })
  const cases = book.cases.map(([id, task_type, snapshot_chapter, question, answer, ...alternatives]) => {
    const paths = alternatives.flat()
    return {
      case_id: `${book.book_id}-${id}`,
      task_type,
      question,
      snapshot_chapter,
      answerable: answer !== null,
      reference_answers: answer === null ? [] : [answer],
      evidence_sets_any_of: paths.map((path) => ({
        all_of: path.map((reference) => {
          const evidence = passages.get(reference)
          if (evidence === undefined) throw new Error(`Unknown passage ${book.book_id}:${reference}`)
          return { ...evidence }
        }),
      })),
    }
  })
  return { book_id: book.book_id, title: book.title, split: book.split, chapters, cases }
}

const benchmark = {
  version: 1,
  annotationStatus: "model_authored_pending_human_review",
  books: authoredBooks.map(expandBook),
}
const summary = validateBenchmark(benchmark)
const frozen = `${JSON.stringify(benchmark, null, 2)}\n`
const target = fileURLToPath(new URL("benchmark.json", import.meta.url))
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== frozen) throw new Error("Frozen benchmark.json differs from authored content")
} else {
  writeFileSync(target, frozen, "utf8")
}
console.log(JSON.stringify(summary, null, 2))
