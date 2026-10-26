-- ============================================================
-- 068: confident past-campaign show match
--
-- NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK.
-- Apply only after 067. Paste into the Supabase SQL Editor, then introspect.
-- Do not run this from the app, a seed script, or a deploy hook.
--
-- 061 is reserved. 067 is the roster-link review note. This is the next number.
--
-- A past_campaign_records row stores matched_show_id only when its
-- show_name normalizes to exactly one eligible show. Eligible means
-- shows.is_discoverable is true, or shows.agent_id equals the row's
-- brand_id (the caller who created that hidden show). Zero matches
-- and two or more matches leave matched_show_id null and mark the
-- row ambiguous. Ambiguous rows stay on the brand's private table.
-- refresh_pooled_import_priors skips them, and it also skips a match
-- whose show is not discoverable. There is no screen for a brand to
-- pick a show by hand.
--
-- The trigger recomputes matched_show_id, status, reason, and
-- confidence for a brand session. It returns the row unchanged when
-- auth.role() is service_role, or when current_user is service_role
-- or postgres. The status, reason, and confidence check still applies
-- to those writes, so a service_role row cannot claim matched without
-- a show id.
--
-- Normalization, kept in lockstep with normalizeShowMatchKey in
-- lib/imports/past-campaigns.ts:
--   U+2019 becomes an apostrophe. U+00A0 becomes a space. U+0130
--   becomes i plus a combining dot. Then each code point is lowercased
--   on its own, the same way as [...s].map(c => c.toLowerCase()). A
--   whole-string toLowerCase would turn a final capital sigma into ς.
--   Then the 32 ASCII punctuation characters
--   and tab, newline, vertical tab, form feed, and carriage return
--   become spaces. Spaces collapse. A leading "the " is removed,
--   repeating. A trailing " podcast" or " show" is removed, repeating.
--   An empty key matches nothing.
-- The punctuation string is !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~
-- normalize_show_match_key sets search_path to empty and qualifies
-- pg_catalog. A later edit has to drop and recreate
-- idx_shows_name_match_key. This file already does that on every paste.
--
-- Existing rows are not updated. A row from before this migration has
-- show_match_status null. If it already has matched_show_id and the
-- show is discoverable, the pool refresh still accepts it.
--
-- This migration does not write shows. It reads shows to match a name
-- and to read categories for the pool. It does not grant anon or public
-- anything. Authenticated keeps select, insert, update, and delete on
-- past_campaign_records. Truncate, references, and trigger stay revoked.
--
-- Idempotent. Safe to re-run. No backfill.
--
-- Introspection (run after applying):
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'past_campaign_records'
--      and column_name in (
--        'show_match_status', 'show_match_reason', 'show_match_confidence'
--      )
--    order by column_name;
--   Expected: show_match_confidence smallint, show_match_reason text,
--   show_match_status text.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'past_campaign_records'
--      and grantee in ('anon', 'PUBLIC')
--    order by grantee, privilege_type;
--   Expected: no rows.
--   select privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'past_campaign_records'
--      and grantee = 'authenticated'
--      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
--   Expected: no rows.
--   select routine_name, grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name in (
--        'normalize_show_match_key',
--        'past_campaign_show_candidates',
--        'enforce_past_campaign_show_match',
--        'refresh_pooled_import_priors'
--      )
--      and grantee in ('anon', 'PUBLIC')
--    order by routine_name, grantee;
--   Expected: no rows.
-- ============================================================

create or replace function public.normalize_show_match_key(raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $norm$
  select nullif(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(pg_catalog.regexp_replace(folded.value, ' +', ' ', 'g')),
          '^(the )+',
          ''
        ),
        '( (podcast|show))+$',
        ''
      )
    ),
    ''
  )
  from (
    select pg_catalog.translate(
      pg_catalog.translate(
        pg_catalog.replace(
          pg_catalog.replace(
            pg_catalog.replace(
              coalesce(raw, ''),
              U&'\2019',
              U&'\0027'
            ),
            U&'\00A0',
            ' '
          ),
          U&'\0130',
          U&'\0069\0307'
        ),
        $casefrom$ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉƊƋƎƏƐƑƓƔƖƗƘƜƝƟƠƢƤƦƧƩƬƮƯƱƲƳƵƷƸƼǄǅǇǈǊǋǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǲǴǶǷǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃɄɅɆɈɊɌɎͰͲͶͿΆΈΉΊΌΎΏΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫϏϘϚϜϞϠϢϤϦϨϪϬϮϴϷϹϺϽϾϿЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӀӁӃӅӇӉӋӍӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖႠႡႢႣႤႥႦႧႨႩႪႫႬႭႮႯႰႱႲႳႴႵႶႷႸႹႺႻႼႽႾႿჀჁჂჃჄჅჇჍᎠᎡᎢᎣᎤᎥᎦᎧᎨᎩᎪᎫᎬᎭᎮᎯᎰᎱᎲᎳᎴᎵᎶᎷᎸᎹᎺᎻᎼᎽᎾᎿᏀᏁᏂᏃᏄᏅᏆᏇᏈᏉᏊᏋᏌᏍᏎᏏᏐᏑᏒᏓᏔᏕᏖᏗᏘᏙᏚᏛᏜᏝᏞᏟᏠᏡᏢᏣᏤᏥᏦᏧᏨᏩᏪᏫᏬᏭᏮᏯᏰᏱᏲᏳᏴᏵᲉᲐᲑᲒᲓᲔᲕᲖᲗᲘᲙᲚᲛᲜᲝᲞᲟᲠᲡᲢᲣᲤᲥᲦᲧᲨᲩᲪᲫᲬᲭᲮᲯᲰᲱᲲᲳᲴᲵᲶᲷᲸᲹᲺᲽᲾᲿḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈἉἊἋἌἍἎἏἘἙἚἛἜἝἨἩἪἫἬἭἮἯἸἹἺἻἼἽἾἿὈὉὊὋὌὍὙὛὝὟὨὩὪὫὬὭὮὯᾈᾉᾊᾋᾌᾍᾎᾏᾘᾙᾚᾛᾜᾝᾞᾟᾨᾩᾪᾫᾬᾭᾮᾯᾸᾹᾺΆᾼῈΈῊΉῌῘῙῚΊῨῩῪΎῬῸΌῺΏῼΩKÅℲⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅬⅭⅮⅯↃⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⰀⰁⰂⰃⰄⰅⰆⰇⰈⰉⰊⰋⰌⰍⰎⰏⰐⰑⰒⰓⰔⰕⰖⰗⰘⰙⰚⰛⰜⰝⰞⰟⰠⰡⰢⰣⰤⰥⰦⰧⰨⰩⰪⰫⰬⰭⰮⰯⱠⱢⱣⱤⱧⱩⱫⱭⱮⱯⱰⱲⱵⱾⱿⲀⲂⲄⲆⲈⲊⲌⲎⲐⲒⲔⲖⲘⲚⲜⲞⲠⲢⲤⲦⲨⲪⲬⲮⲰⲲⲴⲶⲸⲺⲼⲾⳀⳂⳄⳆⳈⳊⳌⳎⳐⳒⳔⳖⳘⳚⳜⳞⳠⳢⳫⳭⳲꙀꙂꙄꙆꙈꙊꙌꙎꙐꙒꙔꙖꙘꙚꙜꙞꙠꙢꙤꙦꙨꙪꙬꚀꚂꚄꚆꚈꚊꚌꚎꚐꚒꚔꚖꚘꚚꜢꜤꜦꜨꜪꜬꜮꜲꜴꜶꜸꜺꜼꜾꝀꝂꝄꝆꝈꝊꝌꝎꝐꝒꝔꝖꝘꝚꝜꝞꝠꝢꝤꝦꝨꝪꝬꝮꝹꝻꝽꝾꞀꞂꞄꞆꞋꞍꞐꞒꞖꞘꞚꞜꞞꞠꞢꞤꞦꞨꞪꞫꞬꞭꞮꞰꞱꞲꞳꞴꞶꞸꞺꞼꞾꟀꟂꟄꟅꟆꟇꟉꟋꟌ꟎Ꟑ꟒꟔ꟖꟘꟚꟜꟵＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇𐐈𐐉𐐊𐐋𐐌𐐍𐐎𐐏𐐐𐐑𐐒𐐓𐐔𐐕𐐖𐐗𐐘𐐙𐐚𐐛𐐜𐐝𐐞𐐟𐐠𐐡𐐢𐐣𐐤𐐥𐐦𐐧𐒰𐒱𐒲𐒳𐒴𐒵𐒶𐒷𐒸𐒹𐒺𐒻𐒼𐒽𐒾𐒿𐓀𐓁𐓂𐓃𐓄𐓅𐓆𐓇𐓈𐓉𐓊𐓋𐓌𐓍𐓎𐓏𐓐𐓑𐓒𐓓𐕰𐕱𐕲𐕳𐕴𐕵𐕶𐕷𐕸𐕹𐕺𐕼𐕽𐕾𐕿𐖀𐖁𐖂𐖃𐖄𐖅𐖆𐖇𐖈𐖉𐖊𐖌𐖍𐖎𐖏𐖐𐖑𐖒𐖔𐖕𐲀𐲁𐲂𐲃𐲄𐲅𐲆𐲇𐲈𐲉𐲊𐲋𐲌𐲍𐲎𐲏𐲐𐲑𐲒𐲓𐲔𐲕𐲖𐲗𐲘𐲙𐲚𐲛𐲜𐲝𐲞𐲟𐲠𐲡𐲢𐲣𐲤𐲥𐲦𐲧𐲨𐲩𐲪𐲫𐲬𐲭𐲮𐲯𐲰𐲱𐲲𐵐𐵑𐵒𐵓𐵔𐵕𐵖𐵗𐵘𐵙𐵚𐵛𐵜𐵝𐵞𐵟𐵠𐵡𐵢𐵣𐵤𐵥𑢠𑢡𑢢𑢣𑢤𑢥𑢦𑢧𑢨𑢩𑢪𑢫𑢬𑢭𑢮𑢯𑢰𑢱𑢲𑢳𑢴𑢵𑢶𑢷𑢸𑢹𑢺𑢻𑢼𑢽𑢾𑢿𖹀𖹁𖹂𖹃𖹄𖹅𖹆𖹇𖹈𖹉𖹊𖹋𖹌𖹍𖹎𖹏𖹐𖹑𖹒𖹓𖹔𖹕𖹖𖹗𖹘𖹙𖹚𖹛𖹜𖹝𖹞𖹟𖺠𖺡𖺢𖺣𖺤𖺥𖺦𖺧𖺨𖺩𖺪𖺫𖺬𖺭𖺮𖺯𖺰𖺱𖺲𖺳𖺴𖺵𖺶𖺷𖺸𞤀𞤁𞤂𞤃𞤄𞤅𞤆𞤇𞤈𞤉𞤊𞤋𞤌𞤍𞤎𞤏𞤐𞤑𞤒𞤓𞤔𞤕𞤖𞤗𞤘𞤙𞤚𞤛𞤜𞤝𞤞𞤟𞤠𞤡$casefrom$,
        $caseto$abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷÿźżžɓƃƅɔƈɖɗƌǝəɛƒɠɣɩɨƙɯɲɵơƣƥʀƨʃƭʈưʊʋƴƶʒƹƽǆǆǉǉǌǌǎǐǒǔǖǘǚǜǟǡǣǥǧǩǫǭǯǳǳǵƕƿǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟƞȣȥȧȩȫȭȯȱȳⱥȼƚⱦɂƀʉʌɇɉɋɍɏͱͳͷϳάέήίόύώαβγδεζηθικλμνξοπρστυφχψωϊϋϗϙϛϝϟϡϣϥϧϩϫϭϯθϸϲϻͻͼͽѐёђѓєѕіїјљњћќѝўџабвгдежзийклмнопрстуфхцчшщъыьэюяѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӏӂӄӆӈӊӌӎӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯաբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆⴀⴁⴂⴃⴄⴅⴆⴇⴈⴉⴊⴋⴌⴍⴎⴏⴐⴑⴒⴓⴔⴕⴖⴗⴘⴙⴚⴛⴜⴝⴞⴟⴠⴡⴢⴣⴤⴥⴧⴭꭰꭱꭲꭳꭴꭵꭶꭷꭸꭹꭺꭻꭼꭽꭾꭿꮀꮁꮂꮃꮄꮅꮆꮇꮈꮉꮊꮋꮌꮍꮎꮏꮐꮑꮒꮓꮔꮕꮖꮗꮘꮙꮚꮛꮜꮝꮞꮟꮠꮡꮢꮣꮤꮥꮦꮧꮨꮩꮪꮫꮬꮭꮮꮯꮰꮱꮲꮳꮴꮵꮶꮷꮸꮹꮺꮻꮼꮽꮾꮿᏸᏹᏺᏻᏼᏽᲊაბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰჱჲჳჴჵჶჷჸჹჺჽჾჿḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕßạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿἀἁἂἃἄἅἆἇἐἑἒἓἔἕἠἡἢἣἤἥἦἧἰἱἲἳἴἵἶἷὀὁὂὃὄὅὑὓὕὗὠὡὢὣὤὥὦὧᾀᾁᾂᾃᾄᾅᾆᾇᾐᾑᾒᾓᾔᾕᾖᾗᾠᾡᾢᾣᾤᾥᾦᾧᾰᾱὰάᾳὲέὴήῃῐῑὶίῠῡὺύῥὸόὼώῳωkåⅎⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻⅼⅽⅾⅿↄⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⰰⰱⰲⰳⰴⰵⰶⰷⰸⰹⰺⰻⰼⰽⰾⰿⱀⱁⱂⱃⱄⱅⱆⱇⱈⱉⱊⱋⱌⱍⱎⱏⱐⱑⱒⱓⱔⱕⱖⱗⱘⱙⱚⱛⱜⱝⱞⱟⱡɫᵽɽⱨⱪⱬɑɱɐɒⱳⱶȿɀⲁⲃⲅⲇⲉⲋⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱⲳⲵⲷⲹⲻⲽⲿⳁⳃⳅⳇⳉⳋⳍⳏⳑⳓⳕⳗⳙⳛⳝⳟⳡⳣⳬⳮⳳꙁꙃꙅꙇꙉꙋꙍꙏꙑꙓꙕꙗꙙꙛꙝꙟꙡꙣꙥꙧꙩꙫꙭꚁꚃꚅꚇꚉꚋꚍꚏꚑꚓꚕꚗꚙꚛꜣꜥꜧꜩꜫꜭꜯꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯꝺꝼᵹꝿꞁꞃꞅꞇꞌɥꞑꞓꞗꞙꞛꞝꞟꞡꞣꞥꞧꞩɦɜɡɬɪʞʇʝꭓꞵꞷꞹꞻꞽꞿꟁꟃꞔʂᶎꟈꟊɤꟍ꟏ꟑꟓꟕꟗꟙꟛƛꟶａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ𐐨𐐩𐐪𐐫𐐬𐐭𐐮𐐯𐐰𐐱𐐲𐐳𐐴𐐵𐐶𐐷𐐸𐐹𐐺𐐻𐐼𐐽𐐾𐐿𐑀𐑁𐑂𐑃𐑄𐑅𐑆𐑇𐑈𐑉𐑊𐑋𐑌𐑍𐑎𐑏𐓘𐓙𐓚𐓛𐓜𐓝𐓞𐓟𐓠𐓡𐓢𐓣𐓤𐓥𐓦𐓧𐓨𐓩𐓪𐓫𐓬𐓭𐓮𐓯𐓰𐓱𐓲𐓳𐓴𐓵𐓶𐓷𐓸𐓹𐓺𐓻𐖗𐖘𐖙𐖚𐖛𐖜𐖝𐖞𐖟𐖠𐖡𐖣𐖤𐖥𐖦𐖧𐖨𐖩𐖪𐖫𐖬𐖭𐖮𐖯𐖰𐖱𐖳𐖴𐖵𐖶𐖷𐖸𐖹𐖻𐖼𐳀𐳁𐳂𐳃𐳄𐳅𐳆𐳇𐳈𐳉𐳊𐳋𐳌𐳍𐳎𐳏𐳐𐳑𐳒𐳓𐳔𐳕𐳖𐳗𐳘𐳙𐳚𐳛𐳜𐳝𐳞𐳟𐳠𐳡𐳢𐳣𐳤𐳥𐳦𐳧𐳨𐳩𐳪𐳫𐳬𐳭𐳮𐳯𐳰𐳱𐳲𐵰𐵱𐵲𐵳𐵴𐵵𐵶𐵷𐵸𐵹𐵺𐵻𐵼𐵽𐵾𐵿𐶀𐶁𐶂𐶃𐶄𐶅𑣀𑣁𑣂𑣃𑣄𑣅𑣆𑣇𑣈𑣉𑣊𑣋𑣌𑣍𑣎𑣏𑣐𑣑𑣒𑣓𑣔𑣕𑣖𑣗𑣘𑣙𑣚𑣛𑣜𑣝𑣞𑣟𖹠𖹡𖹢𖹣𖹤𖹥𖹦𖹧𖹨𖹩𖹪𖹫𖹬𖹭𖹮𖹯𖹰𖹱𖹲𖹳𖹴𖹵𖹶𖹷𖹸𖹹𖹺𖹻𖹼𖹽𖹾𖹿𖺻𖺼𖺽𖺾𖺿𖻀𖻁𖻂𖻃𖻄𖻅𖻆𖻇𖻈𖻉𖻊𖻋𖻌𖻍𖻎𖻏𖻐𖻑𖻒𖻓𞤢𞤣𞤤𞤥𞤦𞤧𞤨𞤩𞤪𞤫𞤬𞤭𞤮𞤯𞤰𞤱𞤲𞤳𞤴𞤵𞤶𞤷𞤸𞤹𞤺𞤻𞤼𞤽𞤾𞤿𞥀𞥁𞥂𞥃$caseto$
      ),
      $punct$!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~$punct$
        || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11)
        || pg_catalog.chr(12) || pg_catalog.chr(13),
      pg_catalog.repeat(' ', 37)
    ) as value
  ) folded;
$norm$;

comment on function public.normalize_show_match_key(text) is
  'Match key for a show name. Unicode case, U+2019 and U+00A0 folded, ASCII punctuation, a leading the, and trailing podcast or show suffixes. Empty becomes null. Immutable so the shows index can use it. search_path is empty.';

drop index if exists public.idx_shows_name_match_key;
create index idx_shows_name_match_key
  on public.shows (public.normalize_show_match_key(name));

alter table public.past_campaign_records
  add column if not exists show_match_status text;

alter table public.past_campaign_records
  add column if not exists show_match_reason text;

alter table public.past_campaign_records
  add column if not exists show_match_confidence smallint;

alter table public.past_campaign_records
  drop constraint if exists past_campaign_records_show_match_check;
alter table public.past_campaign_records
  add constraint past_campaign_records_show_match_check
  check (
    show_match_status is null
    or (
      show_match_status = 'matched'
      and matched_show_id is not null
      and show_match_reason = 'unique_normalized_name'
      and show_match_confidence = 1
    )
    or (
      show_match_status = 'ambiguous'
      and matched_show_id is null
      and show_match_reason in (
        'no_normalized_match',
        'multiple_normalized_matches'
      )
      and show_match_confidence = 0
    )
  );

comment on column public.past_campaign_records.matched_show_id is
  'Set only when the normalized show name matches exactly one eligible show. Eligible means is_discoverable, or agent_id equals this row''s brand_id. Null when the name matches nothing or more than one show. The show cannot read this row.';

comment on column public.past_campaign_records.show_match_status is
  'matched or ambiguous. Null on rows written before migration 068, and on rows a service_role or postgres session left unset. Ambiguous rows stay private to the brand.';

comment on column public.past_campaign_records.show_match_reason is
  'unique_normalized_name, no_normalized_match, or multiple_normalized_matches. Null on rows written before migration 068, and on rows a service_role or postgres session left unset.';

comment on column public.past_campaign_records.show_match_confidence is
  '1 when the normalized name matches one eligible show. 0 when it does not. Null on rows written before migration 068, and on rows a service_role or postgres session left unset.';

revoke all on table public.past_campaign_records from public;
revoke all on table public.past_campaign_records from anon;
revoke truncate, references, trigger on table public.past_campaign_records from authenticated;

-- Login-only read of candidate shows. auth.uid() is the caller.
-- Hidden shows are returned only when shows.agent_id is that caller.
-- Two rows are enough to prove the name is not unique.

create or replace function public.past_campaign_show_candidates(match_key text)
returns table (
  id uuid,
  name text,
  is_discoverable boolean,
  agent_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.name, s.is_discoverable, s.agent_id
  from public.shows s
  where match_key is not null
    and public.normalize_show_match_key(s.name) = match_key
    and (
      s.is_discoverable = true
      or s.agent_id = auth.uid()
    )
  limit 2;
$$;

comment on function public.past_campaign_show_candidates(text) is
  'Shows whose normalized name equals match_key and which this caller may link. Discoverable shows, plus hidden shows this caller created. At most two rows.';

create or replace function public.enforce_past_campaign_show_match()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  match_key text;
  match_ids uuid[];
begin
  -- service_role writes, including auth.role() from the JWT, and
  -- postgres (SQL editor, migrations) keep the id they supplied.
  -- The check constraint still rejects an inconsistent status.
  if current_user in ('service_role', 'postgres') then
    return new;
  end if;
  if auth.role() = 'service_role' then
    return new;
  end if;

  match_key := public.normalize_show_match_key(new.show_name);
  if match_key is null then
    new.matched_show_id := null;
    new.show_match_status := 'ambiguous';
    new.show_match_reason := 'no_normalized_match';
    new.show_match_confidence := 0;
    return new;
  end if;

  select coalesce(array_agg(found.id), '{}'::uuid[])
    into match_ids
  from (
    select s.id
    from public.shows s
    where public.normalize_show_match_key(s.name) = match_key
      and (
        s.is_discoverable = true
        or s.agent_id = new.brand_id
      )
    limit 2
  ) found;

  if cardinality(match_ids) = 1 then
    new.matched_show_id := match_ids[1];
    new.show_match_status := 'matched';
    new.show_match_reason := 'unique_normalized_name';
    new.show_match_confidence := 1;
  elsif cardinality(match_ids) = 0 then
    new.matched_show_id := null;
    new.show_match_status := 'ambiguous';
    new.show_match_reason := 'no_normalized_match';
    new.show_match_confidence := 0;
  else
    new.matched_show_id := null;
    new.show_match_status := 'ambiguous';
    new.show_match_reason := 'multiple_normalized_matches';
    new.show_match_confidence := 0;
  end if;
  return new;
end;
$$;

comment on function public.enforce_past_campaign_show_match() is
  'Forces matched_show_id from the normalized show name for a brand session. service_role and postgres writes are kept. Does not write shows.';

drop trigger if exists past_campaign_records_show_match on public.past_campaign_records;
create trigger past_campaign_records_show_match
  before insert or update on public.past_campaign_records
  for each row
  execute function public.enforce_past_campaign_show_match();

revoke all on function public.normalize_show_match_key(text) from public;
revoke all on function public.normalize_show_match_key(text) from anon;
grant execute on function public.normalize_show_match_key(text) to authenticated;
grant execute on function public.normalize_show_match_key(text) to service_role;

revoke all on function public.past_campaign_show_candidates(text) from public;
revoke all on function public.past_campaign_show_candidates(text) from anon;
grant execute on function public.past_campaign_show_candidates(text) to authenticated;
grant execute on function public.past_campaign_show_candidates(text) to service_role;

revoke all on function public.enforce_past_campaign_show_match() from public;
revoke all on function public.enforce_past_campaign_show_match() from anon;
grant execute on function public.enforce_past_campaign_show_match() to authenticated;
grant execute on function public.enforce_past_campaign_show_match() to service_role;

-- Pool refresh from 058, plus the I2b gates. Ambiguous rows never
-- enter the pool. A null show_match_status is a pre-068 row and
-- still enters when matched_show_id is set and the show is
-- discoverable. A hidden show stays on the private row.
-- service_role only. Does not write shows.

create or replace function public.refresh_pooled_import_priors()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_count integer;
begin
  -- This delete and the insert below are the only writes.
  -- shows is read for categories. It is not updated.
  delete from public.pooled_import_priors where true;

  insert into public.pooled_import_priors (
    category,
    placement,
    price_type,
    brand_count,
    record_count,
    median_cpm,
    median_conversions_per_1k_downloads,
    refreshed_at
  )
  select
    grouped.category,
    grouped.placement,
    grouped.price_type,
    grouped.brand_count,
    grouped.record_count,
    case
      when grouped.price_type = 'cpm' then grouped.median_rate
      else null
    end,
    grouped.median_conversions_per_1k,
    now()
  from (
    select
      cats.category,
      rec.placement,
      rec.price_type,
      count(distinct rec.brand_id)::integer as brand_count,
      count(*)::integer as record_count,
      percentile_cont(0.5) within group (order by rec.rate)
        filter (where rec.rate is not null) as median_rate,
      percentile_cont(0.5) within group (
        order by (rec.conversions::numeric * 1000) / nullif(rec.downloads, 0)
      ) filter (
        where rec.downloads is not null
          and rec.downloads > 0
          and rec.conversions is not null
      ) as median_conversions_per_1k
    from public.past_campaign_records rec
    join public.past_campaign_imports imp
      on imp.id = rec.import_id
     and imp.brand_id = rec.brand_id
    join public.shows sh
      on sh.id = rec.matched_show_id
     and sh.is_discoverable
    cross join lateral (
      select distinct btrim(cat) as category
      from unnest(coalesce(sh.categories, '{}'::text[])) as cat
      where cat is not null
        and btrim(cat) <> ''
    ) cats
    where imp.status = 'confirmed'
      and imp.pooling_consent = true
      and rec.matched_show_id is not null
      and (
        rec.show_match_status is null
        or rec.show_match_status = 'matched'
      )
    group by cats.category, rec.placement, rec.price_type
    having count(distinct rec.brand_id) >= 5
  ) grouped;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.refresh_pooled_import_priors() from public;
revoke all on function public.refresh_pooled_import_priors() from anon;
revoke all on function public.refresh_pooled_import_priors() from authenticated;
grant execute on function public.refresh_pooled_import_priors() to service_role;

comment on function public.refresh_pooled_import_priors() is
  'Rebuilds pooled_import_priors from consented confirmed imports. Skips ambiguous past-campaign rows and hidden shows. service_role only. Does not write shows. Do not schedule from a deploy hook or cron in this job.';
