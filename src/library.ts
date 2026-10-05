/**
 * Curated fallback questions: two per domain, written to be safe for anyone (no household, job or state assumed).
 * One is used only when a drafted question fails review twice. Positions and strengths were set by hand.
 * `o` holds [position, strength] per option, in the same order as each language's option texts.
 */
import type { Locale, Widget } from "./types";

type Wording = { prompt: string; options?: string[]; left?: string; right?: string };
export type LibraryItem = { key: string; domain: string; type: Widget; o: [number, number][]; text: Record<Locale, Wording> };

export const LIBRARY: LibraryItem[] = [
  {
    key: "economy-rent", domain: "economy", type: "either", o: [[20, 0.8], [78, 0.8]],
    text: {
      en: { prompt: "Rents in a growing city have jumped a fifth in two years. The council can cap yearly increases, or clear the way for builders and let prices settle on their own.", options: ["Let builders build and prices settle", "Cap the increases now"] },
      es: { prompt: "En una ciudad que crece, los alquileres han subido una quinta parte en dos años. El ayuntamiento puede limitar las subidas anuales o facilitar la construcción y dejar que los precios se ajusten solos.", options: ["Que se construya y los precios se ajusten", "Limitar las subidas ya"] },
      pt: { prompt: "Numa cidade em crescimento, os aluguéis subiram um quinto em dois anos. A câmara pode limitar os aumentos anuais ou facilitar a construção e deixar os preços se ajustarem sozinhos.", options: ["Deixar construir e os preços se ajustarem", "Limitar os aumentos agora"] },
      zh: { prompt: "一座发展中的城市，房租两年涨了五分之一。市议会可以限制每年的涨幅，也可以放开建房，让价格自行回落。", options: ["放开建房，让价格自己回落", "现在就限制涨幅"] },
      ru: { prompt: "В растущем городе аренда за два года подорожала на пятую часть. Городской совет может ограничить ежегодный рост цен или упростить стройку и дать ценам выровняться самим.", options: ["Пусть строят, цены выровняются сами", "Ограничить рост цен сейчас"] },
    },
  },
  {
    key: "economy-employer", domain: "economy", type: "slider", o: [],
    text: {
      en: { prompt: "A large employer says it will leave town and take 2,000 jobs with it unless the state gives it a tax break.", left: "No special deals", right: "Step in, save jobs" },
      es: { prompt: "Una gran empresa dice que se irá de la ciudad y se llevará 2.000 empleos si el estado no le concede una rebaja de impuestos.", left: "Sin tratos especiales", right: "Intervenir, salvar empleos" },
      pt: { prompt: "Uma grande empresa diz que vai sair da cidade e levar 2.000 empregos se o estado não lhe der um desconto nos impostos.", left: "Sem acordos especiais", right: "Intervir, salvar empregos" },
      zh: { prompt: "一家大企业表示，如果州政府不给它减税，它就搬走，并带走两千个工作岗位。", left: "不搞特殊优惠", right: "出手保住岗位" },
      ru: { prompt: "Крупный работодатель заявляет, что уйдёт из города и заберёт 2000 рабочих мест, если штат не даст ему налоговую льготу.", left: "Никаких особых сделок", right: "Вмешаться, спасти места" },
    },
  },
  {
    key: "welfare-benefit", domain: "welfare", type: "options", o: [[12, 0.8], [38, 0.7], [68, 0.7], [92, 0.85]],
    text: {
      en: { prompt: "A state has money for one new family benefit and has to decide who gets it.", options: ["Only families below the poverty line, with checks", "Working families who earn too little, with a simple form", "Every family with children, scaled by income", "Every family with children, same amount, no forms"] },
      es: { prompt: "Un estado tiene dinero para una nueva ayuda familiar y debe decidir quién la recibe.", options: ["Solo familias bajo el umbral de pobreza, con controles", "Familias trabajadoras que ganan poco, con un formulario sencillo", "Todas las familias con hijos, según sus ingresos", "Todas las familias con hijos, la misma cantidad, sin trámites"] },
      pt: { prompt: "Um estado tem dinheiro para um novo apoio às famílias e precisa decidir quem recebe.", options: ["Só famílias abaixo da linha da pobreza, com verificação", "Famílias que trabalham e ganham pouco, com um formulário simples", "Todas as famílias com filhos, conforme a renda", "Todas as famílias com filhos, mesmo valor, sem formulários"] },
      zh: { prompt: "某州有一笔钱，可以设立一项新的家庭补助，需要决定发给谁。", options: ["只给贫困线以下的家庭，并核查资格", "给收入偏低的工薪家庭，填一张简单表格", "所有有孩子的家庭，按收入分档", "所有有孩子的家庭，金额相同，不用申请"] },
      ru: { prompt: "У штата есть деньги на одно новое пособие для семей, и нужно решить, кто его получит.", options: ["Только семьи за чертой бедности, с проверками", "Работающие семьи с низким доходом, по простой анкете", "Все семьи с детьми, в зависимости от дохода", "Все семьи с детьми, одинаковая сумма, без бумаг"] },
    },
  },
  {
    key: "welfare-lunch", domain: "welfare", type: "either", o: [[22, 0.8], [85, 0.8]],
    text: {
      en: { prompt: "School lunch can be free for every student, or free only for students whose families apply and qualify, with the savings kept for other needs.", options: ["Free for those who qualify", "Free for every student"] },
      es: { prompt: "El almuerzo escolar puede ser gratis para todos los alumnos, o solo para quienes lo soliciten y cumplan los requisitos, reservando el ahorro para otras necesidades.", options: ["Gratis para quienes cumplan los requisitos", "Gratis para todos los alumnos"] },
      pt: { prompt: "A merenda escolar pode ser gratuita para todos os alunos, ou só para quem pedir e cumprir os requisitos, guardando a economia para outras necessidades.", options: ["Gratuita para quem cumprir os requisitos", "Gratuita para todos os alunos"] },
      zh: { prompt: "学校午餐可以对所有学生免费，也可以只对申请并符合条件的家庭免费，把省下的钱用在别处。", options: ["只对符合条件的学生免费", "对所有学生免费"] },
      ru: { prompt: "Школьные обеды можно сделать бесплатными для всех учеников или только для тех, чьи семьи подали заявку и подходят по условиям, а сэкономленное направить на другие нужды.", options: ["Бесплатно тем, кто подходит по условиям", "Бесплатно всем ученикам"] },
    },
  },
  {
    key: "liberty-shops", domain: "liberty", type: "slider", o: [],
    text: {
      en: { prompt: "A town is deciding whether adults may buy marijuana at licensed shops on its main street.", left: "Adults decide", right: "Town says no" },
      es: { prompt: "Un pueblo decide si los adultos podrán comprar marihuana en tiendas con licencia en su calle principal.", left: "Deciden los adultos", right: "El pueblo dice no" },
      pt: { prompt: "Uma cidade decide se adultos poderão comprar maconha em lojas licenciadas na rua principal.", left: "Os adultos decidem", right: "A cidade diz não" },
      zh: { prompt: "一个小镇正在决定，是否允许成年人在主街的持牌商店购买大麻。", left: "成年人自己决定", right: "镇上说不行" },
      ru: { prompt: "Город решает, можно ли взрослым покупать марихуану в лицензированных магазинах на главной улице.", left: "Решают взрослые", right: "Город против" },
    },
  },
  {
    key: "liberty-rentals", domain: "liberty", type: "either", o: [[20, 0.75], [80, 0.75]],
    text: {
      en: { prompt: "Neighbors on a quiet residential street want to ban short-term rentals there after a run of loud weekend parties.", options: ["Owners decide what to do with their homes", "The neighbors can set that rule"] },
      es: { prompt: "Los vecinos de una calle residencial tranquila quieren prohibir allí los alquileres de corta estancia tras varias fiestas ruidosas de fin de semana.", options: ["Cada dueño decide qué hacer con su casa", "Los vecinos pueden poner esa norma"] },
      pt: { prompt: "Moradores de uma rua residencial tranquila querem proibir ali os aluguéis de curta duração depois de várias festas barulhentas no fim de semana.", options: ["Cada dono decide o que fazer com a sua casa", "Os vizinhos podem criar essa regra"] },
      zh: { prompt: "一条安静住宅街的居民，在接连几个周末被吵闹派对打扰后，想禁止这里的短租。", options: ["房主自己决定怎么用房子", "邻居们可以定这条规矩"] },
      ru: { prompt: "Жители тихой улицы хотят запретить на ней краткосрочную аренду после нескольких шумных вечеринок по выходным.", options: ["Владельцы сами решают, что делать с домом", "Соседи вправе установить такое правило"] },
    },
  },
  {
    key: "security-plates", domain: "security", type: "either", o: [[18, 0.8], [84, 0.8]],
    text: {
      en: { prompt: "After a string of break-ins, police ask to put license plate readers on every road into town.", options: ["No, that tracks everyone who drives by", "Yes, if it catches them"] },
      es: { prompt: "Tras una serie de robos en viviendas, la policía pide instalar lectores de matrículas en todas las entradas del pueblo.", options: ["No, eso rastrea a todo el que pasa", "Sí, si sirve para atraparlos"] },
      pt: { prompt: "Depois de uma série de arrombamentos, a polícia pede para instalar leitores de placas em todas as entradas da cidade.", options: ["Não, isso rastreia todo mundo que passa", "Sim, se servir para pegá-los"] },
      zh: { prompt: "接连发生多起入室盗窃后，警方要求在进城的每条路上安装车牌识别设备。", options: ["不行，这等于追踪每个路过的人", "可以，只要能抓到人"] },
      ru: { prompt: "После серии краж со взломом полиция просит поставить считыватели номеров на всех въездах в город.", options: ["Нет, так следят за каждым проезжающим", "Да, если это поможет их поймать"] },
    },
  },
  {
    key: "security-encryption", domain: "security", type: "slider", o: [],
    text: {
      en: { prompt: "A phone maker could build a way for police with a warrant to read encrypted messages. The same opening could also be found by criminals.", left: "Keep it locked", right: "Open with warrant" },
      es: { prompt: "Un fabricante de teléfonos podría crear una vía para que la policía, con orden judicial, lea mensajes cifrados. Esa misma vía también podrían encontrarla los delincuentes.", left: "Que siga cerrado", right: "Abrir con orden" },
      pt: { prompt: "Um fabricante de celulares poderia criar um caminho para a polícia, com mandado, ler mensagens criptografadas. Esse mesmo caminho também poderia ser achado por criminosos.", left: "Manter trancado", right: "Abrir com mandado" },
      zh: { prompt: "手机厂商可以为持有搜查令的警方留一条读取加密信息的通道。但同一条通道也可能被罪犯找到。", left: "保持锁死", right: "凭搜查令打开" },
      ru: { prompt: "Производитель телефонов мог бы сделать способ, чтобы полиция по ордеру читала зашифрованные сообщения. Но ту же лазейку могут найти и преступники.", left: "Оставить закрытым", right: "Открывать по ордеру" },
    },
  },
  {
    key: "immigration-ten-years", domain: "immigration", type: "options", o: [[12, 0.85], [38, 0.7], [62, 0.7], [92, 0.9]],
    text: {
      en: { prompt: "A new rule is being written for people who have lived in the country without papers for ten years and have no criminal record.", options: ["Give them a path to citizenship", "Legal status and work permits, no citizenship", "Temporary permits, reviewed every few years", "They should have to leave"] },
      es: { prompt: "Se está redactando una nueva norma para personas que llevan diez años en el país sin papeles y no tienen antecedentes penales.", options: ["Darles una vía hacia la ciudadanía", "Estatus legal y permiso de trabajo, sin ciudadanía", "Permisos temporales, revisados cada pocos años", "Deberían tener que irse"] },
      pt: { prompt: "Está sendo escrita uma nova regra para pessoas que vivem no país há dez anos sem documentos e não têm antecedentes criminais.", options: ["Dar a elas um caminho para a cidadania", "Status legal e permissão de trabalho, sem cidadania", "Permissões temporárias, revistas a cada poucos anos", "Elas deveriam ter que sair"] },
      zh: { prompt: "一项新规定正在起草，对象是在本国无证居住满十年、且没有犯罪记录的人。", options: ["给他们一条入籍的路", "给合法身份和工作许可，但不入籍", "发临时许可，每隔几年审查一次", "他们应该离开"] },
      ru: { prompt: "Пишется новое правило для людей, которые десять лет живут в стране без документов и не имеют судимостей.", options: ["Дать им путь к гражданству", "Легальный статус и право работать, без гражданства", "Временные разрешения с пересмотром раз в несколько лет", "Они должны уехать"] },
    },
  },
  {
    key: "immigration-visas", domain: "immigration", type: "either", o: [[22, 0.75], [78, 0.75]],
    text: {
      en: { prompt: "Farms and builders in the area say they cannot find workers. One answer is more work visas. The other is to hold the line and let wages rise until locals take the jobs.", options: ["More work visas", "Hold the line"] },
      es: { prompt: "Las granjas y constructoras de la zona dicen que no encuentran trabajadores. Una respuesta es dar más visas de trabajo. La otra es mantener el límite y dejar que suban los salarios hasta que la gente local acepte esos empleos.", options: ["Más visas de trabajo", "Mantener el límite"] },
      pt: { prompt: "Fazendas e construtoras da região dizem que não encontram trabalhadores. Uma resposta é dar mais vistos de trabalho. A outra é manter o limite e deixar os salários subirem até que os moradores aceitem essas vagas.", options: ["Mais vistos de trabalho", "Manter o limite"] },
      zh: { prompt: "当地的农场和建筑商说招不到工人。一种办法是多发工作签证；另一种是守住限额，让工资上涨，直到本地人愿意来做。", options: ["多发工作签证", "守住限额"] },
      ru: { prompt: "Местные фермы и строители говорят, что не могут найти работников. Один ответ: выдать больше рабочих виз. Другой: держать лимит и дать зарплатам вырасти, пока на эти места не пойдут местные.", options: ["Больше рабочих виз", "Держать лимит"] },
    },
  },
  {
    key: "foreign-ally", domain: "foreign", type: "slider", o: [],
    text: {
      en: { prompt: "A country allied with the United States is invaded and asks for American weapons and money. No American troops would be involved.", left: "Not our fight", right: "Send what's needed" },
      es: { prompt: "Un país aliado de Estados Unidos es invadido y pide armas y dinero estadounidenses. No participarían tropas de EE. UU.", left: "No es nuestra guerra", right: "Enviar lo necesario" },
      pt: { prompt: "Um país aliado dos Estados Unidos é invadido e pede armas e dinheiro americanos. Nenhuma tropa americana seria envolvida.", left: "Não é nossa guerra", right: "Enviar o necessário" },
      zh: { prompt: "一个美国的盟国遭到入侵，请求美国提供武器和资金，但不需要美军参战。", left: "不关我们的事", right: "需要什么就给" },
      ru: { prompt: "На страну, союзную США, напали, и она просит американское оружие и деньги. Американские войска участвовать не будут.", left: "Не наша война", right: "Дать всё нужное" },
    },
  },
  {
    key: "foreign-bases", domain: "foreign", type: "either", o: [[20, 0.75], [80, 0.75]],
    text: {
      en: { prompt: "The country keeps tens of thousands of troops at bases overseas to deter rivals and reassure allies. Bringing most of them home would save money and leave those regions to manage on their own.", options: ["Bring most of them home", "Keep them where they are"] },
      es: { prompt: "El país mantiene decenas de miles de soldados en bases en el extranjero para disuadir a sus rivales y dar confianza a sus aliados. Traer a la mayoría de vuelta ahorraría dinero y dejaría que esas regiones se las arreglen solas.", options: ["Traer a la mayoría de vuelta", "Dejarlos donde están"] },
      pt: { prompt: "O país mantém dezenas de milhares de soldados em bases no exterior para conter rivais e dar segurança aos aliados. Trazer a maioria de volta economizaria dinheiro e deixaria essas regiões por conta própria.", options: ["Trazer a maioria de volta", "Mantê-los onde estão"] },
      zh: { prompt: "美国在海外基地驻扎着数万军人，用来威慑对手、安抚盟友。把大部分人撤回国内可以省钱，但那些地区就得自己应对。", options: ["把大部分人撤回来", "让他们留在原地"] },
      ru: { prompt: "Страна держит десятки тысяч военных на базах за рубежом, чтобы сдерживать соперников и поддерживать союзников. Вернуть большинство домой значит сэкономить деньги и оставить эти регионы справляться самим.", options: ["Вернуть большинство домой", "Оставить их там"] },
    },
  },
  {
    key: "energy-plant", domain: "energy", type: "either", o: [[18, 0.8], [84, 0.8]],
    text: {
      en: { prompt: "A utility can keep an old gas plant running and hold bills flat, or replace it with solar and batteries and raise bills by about 8 percent for five years.", options: ["Keep bills flat", "Pay more and switch"] },
      es: { prompt: "Una compañía eléctrica puede seguir usando una vieja central de gas y mantener las facturas, o sustituirla por energía solar y baterías y subirlas cerca de un 8 por ciento durante cinco años.", options: ["Mantener las facturas", "Pagar más y cambiar"] },
      pt: { prompt: "Uma distribuidora pode manter uma velha usina a gás funcionando e segurar as contas, ou trocá-la por energia solar e baterias e aumentar as contas em cerca de 8 por cento por cinco anos.", options: ["Manter as contas como estão", "Pagar mais e trocar"] },
      zh: { prompt: "电力公司可以继续运行一座老旧的燃气电厂，保持电费不变；也可以换成太阳能加储能，未来五年电费上涨约百分之八。", options: ["保持电费不变", "多付一点，换掉它"] },
      ru: { prompt: "Энергокомпания может оставить старую газовую станцию и не повышать счета или заменить её солнечными панелями с батареями и поднять счета примерно на 8 процентов на пять лет.", options: ["Не повышать счета", "Платить больше и перейти"] },
    },
  },
  {
    key: "energy-prices", domain: "energy", type: "options", o: [[12, 0.8], [40, 0.6], [70, 0.7], [86, 0.75]],
    text: {
      en: { prompt: "Gas prices spike, and the state has money to do one thing about it.", options: ["Suspend the gas tax for everyone", "Send rebates to lower-income drivers", "Spend it on buses and trains", "Spend it on electric car chargers"] },
      es: { prompt: "El precio de la gasolina se dispara y el estado tiene dinero para hacer una sola cosa al respecto.", options: ["Suspender el impuesto a la gasolina para todos", "Dar reembolsos a conductores de bajos ingresos", "Gastarlo en autobuses y trenes", "Gastarlo en cargadores para autos eléctricos"] },
      pt: { prompt: "O preço da gasolina dispara e o estado tem dinheiro para fazer uma única coisa a respeito.", options: ["Suspender o imposto da gasolina para todos", "Dar reembolso a motoristas de baixa renda", "Gastar em ônibus e trens", "Gastar em carregadores de carros elétricos"] },
      zh: { prompt: "油价飙升，州政府有一笔钱，但只够做一件事。", options: ["对所有人暂停征收汽油税", "给低收入司机发补贴", "用来发展公交和铁路", "用来建电动车充电桩"] },
      ru: { prompt: "Цены на бензин резко выросли, и у штата есть деньги только на одну меру.", options: ["Временно отменить налог на бензин для всех", "Выплаты водителям с низким доходом", "Потратить на автобусы и поезда", "Потратить на зарядки для электромобилей"] },
    },
  },
  {
    key: "tech-ai-release", domain: "tech", type: "slider", o: [],
    text: {
      en: { prompt: "Every few months companies release AI systems that can do more office work. Waiting for safety licenses would slow them down while rivals abroad keep going.", left: "Let them ship", right: "License them first" },
      es: { prompt: "Cada pocos meses las empresas lanzan sistemas de IA capaces de hacer más trabajo de oficina. Esperar licencias de seguridad las frenaría mientras sus rivales en el extranjero siguen avanzando.", left: "Que los lancen", right: "Primero la licencia" },
      pt: { prompt: "A cada poucos meses as empresas lançam sistemas de IA que fazem mais trabalho de escritório. Esperar licenças de segurança as atrasaria enquanto concorrentes no exterior seguem em frente.", left: "Deixar lançar", right: "Licença primeiro" },
      zh: { prompt: "每隔几个月，就有公司发布能承担更多办公室工作的人工智能系统。等待安全许可会拖慢它们，而国外的对手不会停下。", left: "让它们发布", right: "先拿许可" },
      ru: { prompt: "Каждые несколько месяцев компании выпускают ИИ-системы, которые берут на себя всё больше офисной работы. Ожидание лицензий на безопасность замедлит их, пока зарубежные конкуренты идут дальше.", left: "Пусть выпускают", right: "Сначала лицензия" },
    },
  },
  {
    key: "tech-deepfake", domain: "tech", type: "either", o: [[22, 0.75], [82, 0.8]],
    text: {
      en: { prompt: "A new app lets anyone make a realistic video of any person saying anything. It is also used for comedy, film work and teaching.", options: ["Punish the misuse, not the tool", "Restrict the tool before it spreads"] },
      es: { prompt: "Una nueva aplicación permite a cualquiera crear un video realista de cualquier persona diciendo cualquier cosa. También se usa para comedia, cine y enseñanza.", options: ["Castigar el mal uso, no la herramienta", "Restringir la herramienta antes de que se extienda"] },
      pt: { prompt: "Um novo aplicativo permite a qualquer um criar um vídeo realista de qualquer pessoa dizendo qualquer coisa. Ele também é usado em comédia, cinema e ensino.", options: ["Punir o mau uso, não a ferramenta", "Restringir a ferramenta antes que se espalhe"] },
      zh: { prompt: "一款新应用能让任何人制作出任何人说任何话的逼真视频。它也被用于喜剧、影视制作和教学。", options: ["惩罚滥用，不要限制工具", "趁还没普及，先限制工具"] },
      ru: { prompt: "Новое приложение позволяет любому сделать реалистичное видео, где любой человек говорит что угодно. Им пользуются и для юмора, кино и обучения.", options: ["Наказывать за злоупотребление, а не за инструмент", "Ограничить инструмент, пока он не разошёлся"] },
    },
  },
  {
    key: "education-money", domain: "education", type: "either", o: [[15, 0.85], [86, 0.85]],
    text: {
      en: { prompt: "A state can give each family the public money meant for their child's schooling to spend at any school, or keep that money in neighborhood public schools.", options: ["The money follows the family", "The money stays with public schools"] },
      es: { prompt: "Un estado puede dar a cada familia el dinero público destinado a la educación de su hijo para gastarlo en cualquier escuela, o mantener ese dinero en las escuelas públicas del barrio.", options: ["El dinero sigue a la familia", "El dinero se queda en la escuela pública"] },
      pt: { prompt: "Um estado pode dar a cada família o dinheiro público destinado à educação do filho para gastar em qualquer escola, ou manter esse dinheiro nas escolas públicas do bairro.", options: ["O dinheiro acompanha a família", "O dinheiro fica na escola pública"] },
      zh: { prompt: "州政府可以把每个孩子的公共教育经费直接交给家庭，让他们在任何学校使用；也可以把这笔钱留在社区的公立学校。", options: ["钱跟着家庭走", "钱留在公立学校"] },
      ru: { prompt: "Штат может отдать каждой семье государственные деньги на обучение ребёнка, чтобы тратить их в любой школе, или оставить эти деньги районным государственным школам.", options: ["Деньги идут за семьёй", "Деньги остаются у государственных школ"] },
    },
  },
  {
    key: "education-reading", domain: "education", type: "slider", o: [],
    text: {
      en: { prompt: "A school board is deciding who has the final say over the books on the required reading list.", left: "Parents", right: "Teachers" },
      es: { prompt: "Una junta escolar decide quién tiene la última palabra sobre los libros de la lista de lectura obligatoria.", left: "Los padres", right: "Los docentes" },
      pt: { prompt: "Um conselho escolar decide quem tem a palavra final sobre os livros da lista de leitura obrigatória.", left: "Os pais", right: "Os professores" },
      zh: { prompt: "学区委员会正在决定，必读书目上的书由谁说了算。", left: "家长", right: "教师" },
      ru: { prompt: "Школьный совет решает, за кем последнее слово в списке обязательной литературы.", left: "Родители", right: "Учителя" },
    },
  },
  {
    key: "faith-coach", domain: "faith", type: "either", o: [[15, 0.8], [82, 0.8]],
    text: {
      en: { prompt: "A public high school coach wants to lead a voluntary prayer on the field after games. Some players say they would feel pressure to join.", options: ["Not at a public school event", "Let him, nobody is forced"] },
      es: { prompt: "El entrenador de una escuela secundaria pública quiere dirigir una oración voluntaria en el campo después de los partidos. Algunos jugadores dicen que se sentirían presionados a participar.", options: ["No en un acto de una escuela pública", "Que lo haga, nadie está obligado"] },
      pt: { prompt: "O treinador de uma escola pública de ensino médio quer conduzir uma oração voluntária no campo depois dos jogos. Alguns jogadores dizem que se sentiriam pressionados a participar.", options: ["Não num evento de escola pública", "Deixem, ninguém é obrigado"] },
      zh: { prompt: "一所公立高中的教练想在赛后带领大家在场上做自愿祷告。有些队员说，他们会感到不得不参加的压力。", options: ["公立学校的活动里不该这样", "让他做吧，没人被强迫"] },
      ru: { prompt: "Тренер государственной школы хочет после игр проводить на поле добровольную молитву. Часть игроков говорит, что чувствовала бы давление и присоединялась бы поневоле.", options: ["Не на мероприятии государственной школы", "Пусть проводит, никого не заставляют"] },
    },
  },
  {
    key: "faith-grants", domain: "faith", type: "slider", o: [],
    text: {
      en: { prompt: "A state offers grants to repair historic buildings, and churches apply alongside museums and theaters.", left: "No public money", right: "Treat them alike" },
      es: { prompt: "Un estado ofrece subvenciones para reparar edificios históricos, y las iglesias las solicitan junto a museos y teatros.", left: "Sin dinero público", right: "Tratarlas igual" },
      pt: { prompt: "Um estado oferece verbas para restaurar prédios históricos, e igrejas se candidatam ao lado de museus e teatros.", left: "Sem dinheiro público", right: "Tratar igual" },
      zh: { prompt: "某州为修缮历史建筑提供拨款，教堂和博物馆、剧院一起提出了申请。", left: "不给公款", right: "一视同仁" },
      ru: { prompt: "Штат выделяет гранты на ремонт исторических зданий, и церкви подают заявки наравне с музеями и театрами.", left: "Без бюджетных денег", right: "На равных условиях" },
    },
  },
];
