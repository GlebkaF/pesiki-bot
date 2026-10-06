# Независимая ветка: как сделать советы проверяемыми, а не бесконечно дописывать prompt

Дата: 6 октября 2026. Прочитаны актуальные src/advice-context.ts, advice-model.ts, advice-sources.ts, live-advice.ts, test-live-advice.ts и docs/live-advice-research.md. Это исследовательские гипотезы и проект эксперимента; продукт не менялся, платные модели и Steam не запускались.

## Диагноз по коду

Сейчас решение фактически принимает один LLM: 32 предмета на нашего игрока, описания предметов и возможных способностей десяти героев, длинный общий prompt. Валидация проверяет account, candidate item ID, длины, допустимость threatHeroIds и несколько упоминаний союзника. **Ни одна проверка не доказывает, что Greaves диспелят нужного получателя, BKB решает названный контроль или Silver Edge отключает названную пассивку.** Наличие threatHeroIds не означает, что все смысловые утверждения текста соответствуют списку. Например, пустой массив и «снимет их контроль» остаются возможными. Regex союзных имен не покрывает переводы, местоимения, опечатки и второе упоминание. Он также может отвергать полезное согласование с союзником. Эти guards полезны как аварийная мера, но не являются механической моделью игры.

Текущие unit tests проверяют преимущественно контракт/кеш/компоненты, а не качество выбора или фактические игровые утверждения. Публичный research-документ местами отстал от кода: gameMode и heroId уже сохранены. Это важно для следующего аудита.

Есть полезные основания: ID предметов и героев, явные allies/enemies, проверка свежести, стоимость завершения сборки, исключение невидимых consumed upgrades, общее кеширование и бюджет. Сохраняем, но отделяем три задачи: истинность механики; обоснованность выбора; понятность объяснения. Они требуют разных доказательств.

## Источники и пределы выводов

- [dotaconstants, закрепленный items.json](https://github.com/odota/dotaconstants/blob/b4b5a8299de5f3e0704e62fdd04a6a54c4d4548e/build/items.json), [abilities.json](https://github.com/odota/dotaconstants/blob/b4b5a8299de5f3e0704e62fdd04a6a54c4d4548e/build/abilities.json): полезная исходная фактология, но git revision — происхождение данных, не сертификат каждого взаимодействия текущего буквенного патча. В нынешнем парсере поля эффекта уже превращены в свободный текст, сложные различия не кодируются.
- [Valve New Frontiers](https://www.dota2.com/newfrontiers): официальная историческая точка перехода к debuff immunity. При чтении через web содержимое динамическое, потому конкретные актуальные численные утверждения из него здесь не выводятся. [Официальный 6.84](https://www.dota2.com/684/?l=greek) исторически явно разделяет лечение Greaves и self-dispel; это **не** самостоятельное доказательство актуальности для 7.41f. Тест текущего клиента нужен для спорных current-patch взаимодействий.
- [RefChecker, EMNLP 2024](https://aclanthology.org/2024.emnlp-main.395/) предлагает разложение ответа на отдельные проверяемые claims и сравнение с reference. Берем инженерную идею claims; не переносим benchmark accuracy на Доту. [Код авторов](https://github.com/amazon-science/RefChecker).
- [RAGTruth, ACL 2024](https://aclanthology.org/2024.acl-long.585/) исследует hallucinations в RAG: наличие retrieved текста само по себе не доказывает grounded answer.
- [Chain-of-Verification](https://aclanthology.org/2024.findings-acl.212/) исследует отдельные проверочные вопросы. Это довод попробовать независимую проверку, не гарантия надежности очередного LLM.
- [Self-correction without external feedback](https://arxiv.org/abs/2310.01798) показывает ограничения самопроверки в исследованных reasoning tasks. Не стоит превращать «вторая модель согласилась» в истинность механики.
- [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) показывает чувствительность исследованных моделей к положению релевантного контекста. Это мотивация проверять компактный retrieval против полного дампа на нашей модели, не доказательство, что любая современная модель обязательно сломается.
- [Language Models (Mostly) Know What They Know](https://arxiv.org/abs/2207.05221) исследует self-evaluation и отмечает трудности переноса калибровки на новые задачи. Самооценка LLM «90% уверен» не подходит как готовая вероятность для Dota.

## REASON-1 — типизированные эффекты и доказуемые claims вместо свободной механики

**Гипотеза.** Структурированный каталог небольшого числа важных механик + проверка каждого claim уберет большую часть опасных фактических ошибок без чрезмерной потери полезности.

**Механизм.** Record на уровне эффекта, а не целого предмета: source entity, effect ID, recipient (self/allied-target/allies-in-area/enemy), effect kind, dispel strength/direction, debuff-immunity interaction per component (control/damage отдельно), break-disabled passive list, preconditions, exclusions, patch interval, provenance и verified/unknown status. У одного Greaves должны быть отдельные эффекты team heal и self basic dispel. У сложной способности — несколько компонентов: один bkbpierce=Yes на всю способность недостаточно. Unknown — отдельное значение, не false.

План сначала содержит typed claims: `item-effect X resolves enemy-effect Y for actor A under predicates P`, затем короткий текст. Renderer получает проверенный proof bundle и не вправе добавлять новые target/effect claims. Надежный baseline — шаблоны доказанных claim types; LLM может ранжировать и предлагать цель, но не назначать механику. Нельзя начинать с тотальной онтологии всей Доты: первоначально 15–25 наиболее частых предметов и их реально нужные взаимодействия с героями стака/противниками; unsupported контрвзаимодействия явно отсутствуют.

**Данные.** dotaconstants/Valve patch changes → extraction draft → человек/тест клиента проверяет high-risk effects → versioned JSON в git. Понадобится отдельный журнал проверок текущего патча; такого журнала сейчас нет.

**Контрпример.** Каталог идеально говорит «Silver Edge накладывает break», а выбрали предмет против пассивки с исключением. Правильность факта про предмет не означает правильность `resolves`; нужна конкретная связь с конкретным effect ID. Другой контрпример — неверно размеченный каталог превращает ошибку в машинно «доказанную».

**Решающий тест / go-no-go.** Минимум 60 вручную проверенных атомарных взаимодействий + отрицательные пары: BKB vs piercing control; basic vs strong dispel; self vs ally dispel; break vs исключение; dispel removed/reapplied; Force vs ограничения перемещения. 100% ожидаемых результатов на детерминированном kernel; отдельно zero critical misstatements в независимой holdout-проверке human reader. Это release gate тестового набора, не обещание 100% в реальной Доте. Если каталог неподдерживаем по времени или часто abstains — сузить известные механики, не разрешать LLM заполнять дыры.

## REASON-2 — типизированный actor/team/observation context и минимальная доказательная выборка

**Гипотеза.** Контекст на конкретного адресата с неизменяемыми ID, явно наблюдаемыми/предполагаемыми/неизвестными фактами и ограничением типов доступных действий снизит ошибки союзник-враг и использование несуществующей информации.

**Механизм.** Нормализовать facts: subjectId, predicate, value, observedAt, visibility/source, confidence class. `ours` означает член стака, `teamId` — команда, это разные поля. `possibleAbility` не превращается в `learned`, `ready` или `hasUpgrade`. Retrieval по точным entity IDs и типам механик, затем только релевантные компактные evidence bundles на 3–6 кандидатов; semantic search — лишь поиск новых записей для review, не первичный join боевых фактов.

Поле game.delay=120 из GC SourceTV lobby означает nominal spectator delay; совпадение задержки GetRealtimeStats с ним не измерено. Хранить nominalSpectatorDelay, receivedAt, reportedGameTime, delaySemantics=uncalibrated отдельно. Складывать delay+age как фактическую задержку endpoint нельзя до paired clock calibration с игровыми часами игрока. Неизвестность задержки сохраняется. Из канала advice исключить координатные разведывательные данные/вражеский cooldown, даже если наблюдатель может их увидеть. Для delayed mode action classes: purchase planning, team utility allocation, долгосрочный план. «Прямо сейчас беги/атакуй/у него нет ульты» не генерируются структурой плана.

**Контрпример.** Корректно типизированный враг уже купил BKB в последние 120 секунд. Наблюдение достоверно описывает прошлое, а выбранный предмет уже слабее. Нужен условный совет и актуализация, не просто badge «120 сек».

**Тест.** Метаморфные пары: союзный Weaver ↔ вражеский Weaver; одинаковое имя у разных account; ours=false teammate; перестановка команд/слотов; unknown ability levels/facet; delay missing/120/900; смена inventory в задержанном окне. Меняется только соответствующий evidence/claim, остальные выводы инвариантны. No-go, если после удаления координат/таймеров текст продолжает утверждать их по памяти. Применимость архитектуры подтверждается кодовым контрактом, полезность — человеческим сравнением.

## REASON-3 — ограниченный планировщик покупки с явной ценой альтернативы

**Гипотеза.** Ранжировать небольшой набор допустимых action bundles лучше, чем просить модель выбрать «следующий крупный предмет» из 32 описаний.

**Механизм.** Candidate generator сначала исключает невозможное/дубликаты и создает не только complete item, но `finish upgrade`, `buy useful component`, `hold gold`, `ask role`, `no recommendation`. Оценочные признаки раздельно: threat coverage с known exceptions; герой/стиль и роль; уже вложенное золото; стоимость завершения; team redundancy; slot pressure; defensive/offensive tradeoff. Не объявлять произвольную взвешенную сумму вероятностью победы. LLM может предложить tradeoff и выбрать среди proof-valid bundles; ранжирование сравнивается с простым rules baseline и экспертами.

Компоненты — multiset inventory, каждый экземпляр зачитывается один раз; recipes/components должны иметь точную семантику источника. Не считать видимость слотов полным инвентарем: courier/stash/consumed upgrades отсутствуют. Пропавший Moon Shard/Aghanim upgrade ≠ не куплен. Не рекомендовать повторную покупку расходуемого постоянного апгрейда без подтверждения состояния; разрешить вопрос/условие. Золото снимка не использовать как точный текущий баланс.

**Контрпример.** Игрок начал плохую сборку: бонус за sunk cost навязывает ее завершение; cheapest item дешевый, но не решает главное; неизвестная роль делает Glimmer/BKB разные ответы одинаково правдоподобными. Нужно сравнить cancel/continue, не абсолютный запрет отказаться от компонентов.

**Тест.** Эксперты оценивают top-3 допустимость/выбор на одинаковых слепых снапшотах без итогового исхода. Парные изменения: +компонент, +уже купленный апгрейд, +союзная аура, неизвестный consumed upgrade, gold ±500, role unknown vs verified. Go только при преимуществе над current prompt по harmful-choice rate без обвала полезного coverage; false numeric certainty автоматически no-go. Предварительный порог: >=80% экспертных «разумно и применимо», ни одной критической ошибочной механики в holdout; согласовать/пересмотреть после pilot.

## REASON-4 — team allocation как совместная задача, не пять независимых советов

**Гипотеза.** Согласованное распределение utility между нашими важнее еще одного красивого объяснения индивидуальной сборки.

**Механизм.** Сначала список team needs по composition, затем assignment `(player, item, role condition)` с учетом имеющихся у всех союзников предметов, компонентных вложений и типового использования героя. Роли неизвестны → несколько robust options либо один короткий вопрос вне драки. Already-owned aura снижает предельную пользу, но не тотальный бан дубликата: возможны split positioning/uptime, которые observer не знает. Текст сообщает «если X продолжает Pipe, тебе предпочтительнее Y», а не назначает неизвестному союзнику задачу как исполненную.

**Контрпример.** Модель уверенно распределила utility третьему незнакомому союзнику, он не согласен и играет иначе; табличка выглядит согласованной, команда остается без предмета. Поэтому owned != planned != agreed: separate fields. Членам стака можно предложить согласование, non-stack teammate только observation.

**Тест.** Сценарии 1/2/5 наших; двое уже с одинаковыми компонентами; купленный Pipe у неизвестного союзника; подтвержденные планы конфликтуют. Blind rating командного плана vs независимых советов. No-go если вывод «покупает» основан только на частичном компоненте; никакого hard allocation non-stack teammates без их намерения.

## REASON-5 — abstention по причине и по качеству evidence, а не по настроению LLM

**Гипотеза.** При unknown patch/role/interactions выгоднее дать условную альтернативу или точный вопрос, чем наиболее уверенно звучащий ответ.

**Механизм.** Evidence gate на каждый claim и recommendation. Distinguish `not enough data`, `mechanics unverified`, `choices too close`, `snapshot stale`, `source unavailable`. Возврат частичный: одному игроку совет, другому вопрос, вместо падения всего матча из-за одного. Не сводить все к магическому confidence number. Measured selective-risk/coverage curve на annotated held-out матчах; пороги калибруются offline. Источники c disagreement не усреднять; superseded rule или unresolved conflict закрывает конкретный claim.

Patch handling: registry rules имеет last-verified patch и dependency IDs. Изменившиеся способности/предметы карантинятся при обновлении; незатронутые могут продолжить работу после проверенной классификации diff. Отсутствие mention в патчноуте не доказывает отсутствие изменения. Периодический spot-check и regression matrix по high-risk interactions.

**Контрпример.** Система всегда молчит и имеет 0 ошибок. Это не успех. Нужно вместе мерить meaningful coverage, число условий/вопросов, время пользователя и полезность относительно «никакого совета». Другой failure: несвежая версия falsely marked verified.

**Тест.** Missing fields / патч-дифф / источник конфликтует / тонкая role ambiguity. Отдельные графики risk vs coverage; предложенный стартовый release gate <=1% критических опубликованных claims на независимой выборке и >=60% snapshot-player situations с полезным советом/одним полезным вопросом. Эти цифры продуктовые гипотезы, не вывод из papers. Сначала набрать данные и доверительные интервалы; нулевая ошибка на 50 примерах не доказывает <1%.

## REASON-6 — renderer с проверкой claims + adversarial verifier, не советчик судит себя

**Гипотеза.** Отдельная проверка текста на перенос смысла уменьшит ошибки формулировки поверх корректного решения.

**Механизм.** Решение и evidence frozen. Текст объяснения создается из approved claims. Верификатор получает текст, approved claims и источники, ищет только unsupported/contradicted assertions, меняющийся target или tense. На старте golden template renderer дает semantic reference. Claim extraction/NLI LLM — дополнительный filter, не конечный арбитр. Если он не уверен — fallback к шаблону либо omit. Нельзя «чинить» факт второй моделью без внешнего доказательства; retries bounded.

**Контрпример.** И generator, и verifier учились на одной ошибочной wiki-механике и согласны. Или правильные атомарные claims соединены ложной причинностью: «у врага Spirit Breaker; BKB дает debuff immunity; поэтому тебя не остановят». Проверять conclusion/resolves relation, не только два facts отдельно.

**Тест.** Mutation benchmark: заменить target self→allies, basic→strong, block→reduce, possible→ready, enemy→ally, may→guaranteed, observed→now, omit exception. Измерить precision/recall critical-error detection и false rejections; сравнить шаблон, свободный LLM, LLM+verifier. Go если verifier добавляет измеримый выигрыш сверх typed renderer при приемлемой цене/латентности; иначе оставить offline red team, не усложнять production.

## REASON-7 — benchmark прежде масштабирования; causal claims не брать из win rate

**Гипотеза.** Небольшой тщательно размеченный decision benchmark даст больше прогресса, чем смена модели или обогащение prompt всеми wiki-страницами.

**Механизм.** Собирать истинный вход в момент решения + все source revisions + выбранные action bundles + rejected claims + текст + feedback. Разделять data validity, mechanic validity, strategic reasonableness, usefulness, readability, timeliness, redundancy. Будущий replay может проверить происходившее, но оценщик выбора видит только доступное на тот момент, иначе hindsight leakage. Train/tune/test split по матчам и времени/patch, не по соседним snapshot одного матча.

Экспертам не требовать единственный правильный item: допустимый набор, грубые contraindications, ranking/preferences, их disagreement. Измерять factual-critical errors и dominated choices отдельно. Независимая paired blind оценка current vs proposed vs rules-only, одинаковое evidence, с abstention coverage. Особо выделить Turbo, неизвестную роль, высокий delay, patch changes. Win-rate с предметом — не causal item effect: герой успел разбогатеть/выжить/закончить предмет; такие признаки максимум retrieval prior. Для нашего маленького стака исходы матчей слишком шумны для быстрого доказательства пользы.

**Контрпример.** Benchmark подогнан под три уже замеченные ошибки и считается победой. Нужно держать скрытые новые механики/героев и metamorphic tests; независимый red team авторирует случаи после freeze candidate system.

**Тест/go.** Сначала 30–50 ситуаций для разметочного pilot/согласования rubric, затем >=200 player-decisions из разных матчей для сравнения систем; не называть эту выборку статистически достаточной для <1% без интервалов/размера кластеров. Publish paired counts + intervals и покрытие. Go для пользовательского rollout только если критических механических/target/now ошибок не обнаружено в prerelease critical suite и человеческая usefulness растет при похожем coverage. Цена и latency — отдельный gate, не разрешение ухудшить смысл.

## Что оставить в первом сильном варианте

1. Typed observation/actor model + запрет unsupported action classes (REASON-2).
2. Малый versioned mechanics kernel с проверяемыми effects/resolves rules (REASON-1).
3. Purchase planner + team coordination + unknown/hold/ask actions (REASON-3/4).
4. Evidence gate с информативным partial abstention (REASON-5).
5. Template explanation сначала; свободный LLM только после отдельного сравнения (REASON-6).
6. Независимый benchmark, mutation red team, patch quarantine (REASON-7).

Не брать сразу: giant vector DB, fine-tuning на общих гайдах, multi-agent debate в каждой игре, self-confidence как проценты истины, полноценный Dota simulator, «оптимизация win rate» на агрегатных purchases. У этих идей пока нет доказанного выигрыша для нашей задачи. Исследовательский fanout нужен сейчас для проверки проекта; runtime fanout может оказаться лишней задержкой и совместной галлюцинацией.


## Уточнение root по семантике задержки
GC SourceTV game.delay=120 не доказывает задержку именно GetRealtimeStats. В контрпримерах выше 120 секунд — сценарий номинальной/возможной задержки, а не измеренный runtime SLA. Первичный обязательный эксперимент: согласованные clock observations на стороне игрока и API, метки приема и сравнение reportedGameTime в серии снимков; до этого никакой тактики «прямо сейчас» и никаких точных утверждений 120+age. Это не отменяет typed action classes и temporal uncertainty, а усиливает их необходимость.
