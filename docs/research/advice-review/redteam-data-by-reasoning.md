# Red team DATA-1…7 — независимая проверка reasoning-веткой

6 октября 2026. Проверен /tmp/pesiki-research-data.md, включая production audit root. Продукт не менялся. Статусы относятся к гипотезам в их нынешней формулировке; survival не означает доказанную эффективность. Severity — тяжесть ошибки, если исходный эксперимент/дизайн использовать как release gate без исправления.

## Итоговый вердикт

| Гипотеза | Вердикт | Severity | Главное изменение |
|---|---|---|---|
| DATA-1 data sufficiency contract | survive с обязательным уточнением | major | Достаточность на уровне конкретного claim/action; provenance не равен истинности и полезности |
| DATA-2 union кандидатов с квотами | revise | major | Отвергнуть фиксированные квоты как default; измерять semantic coverage при одинаковом бюджете контекста |
| DATA-3 Turbo cohorts | revise, deferred | major | Сначала audit decision-time snapshots и coverage; 30/группа и retrieval relevance не доказательство хорошего timing reference |
| DATA-4 персональные напоминания | reject в live v1; research only | fatal при behavioral claims | Нет readiness/opportunity ground truth; три случая и absence-of-use не достаточны |
| DATA-5 decision journal | survive | major | Записывать вход целиком и versioned executable/artifacts, не требовать byte-identical regeneration LLM |
| DATA-6 causal A/B benefit | revise, deferred | major | Отделить feasibility от superiority; carryover/interference/accounting; win-rate experiment не нужен сейчас |
| DATA-7 STRATZ spike | survive как ограниченный spike | major | Оценивать missingness/denominator, а не 95% по трем удачным матчам; без обязательной интеграции |

Лучшие решения после атаки: DATA-1 + DATA-5 обязательны; DATA-2 после исправления budget/coverage objective; DATA-7 лишь bounded reconnaissance, если обнаружен конкретный пробел. DATA-3/6 отложить до доказанного качества базового советчика. DATA-4 не публиковать live до отдельного исследования opportunities.

## DATA-1 — контракт достаточности

**Сильнейший контрпример.** Свежий полный snapshot содержит mode, hero и inventory; предметы неизвестного патча. Contract разрешает item planning с оговоркой role unknown. Генератор советует Greaves «чтобы снять команде silence» и аккуратно указывает source revision. Все поля присутствуют, версия и происхождение честные, решение неверное. Более тонко: механика предмета верна, но экономическая/ролевая задача игрока неизвестна — contract не доказывает, что эта покупка хороша.

**Ошибка go/no-go.** 40 valid + 40 invalid fixtures проверяют, что gate ведет себя как задуман, а не что определение `valid strategic decision` адекватно. «90% валидных сохраняются» может быть circular: автор системы сам считает свой набор valid. Удаление одного поля не ловит ошибочные значения/перепутанную команду, delta artifacts, взаимно противоречивые timestamps.

**Необходимое изменение.** Разделить observable validity, evidence validity, rule applicability и decision uncertainty. Каждый action объявляет required facts + negative conditions. Unknown component не false. Provenance contract — только первая ступень. Проверять source-derived claimed facts vs raw fixture, не наличие ссылок. Include delay interval, contradictory sources, explicit uncertainty.

**Kill-test.** Независимый автор дает 20 полных, schema-valid, provenance-valid снимков с ложной применимостью: ally↔enemy, self→team effect, неизвестный consumed upgrade, устаревший cost, role ambiguity. Если хотя бы один unsupported categorical claim публикуется только потому, что required fields присутствуют, контракт нельзя называть достаточным. Если gate спасает только полным молчанием, измерить потерю полезного coverage отдельно.

**Вердикт: survive**, но «sufficiency contract» лучше понимать как контракт допуска проверки, не завершенное доказательство совета.

## DATA-2 — union кандидатов и квоты

**Сильнейший контрпример.** 3 корзины по фиксированной квоте: 5 популярных + 5 counters + 5 компонентов. Лучшие 6 допустимых item routes все в одной корзине; шестой отрезан. Или BKB одновременно популярный, counter и почти собранный, а dedup перераспределяет бюджет непредсказуемо. Manual counter rules на новый patch ошиблись и гарантированная квота дает им незаслуженный приоритет. Чем больше кандидатов, тем выше шанс формального recall≥95%, но хуже реальный выбор/latency.

**Проблема статистики.** Expert names 2–3 items не исчерпывают допустимый action space. Система может выбрать хороший fourth item и считаться ошибкой. Recall≥95% на 60 специально выбранных кадров легко достигнуть выводом половины магазина. Quota не проверяет важную no-purchase/save/component/role-question альтернативу. Популярность профессионалов может скрыть правильный Turbo farm item; defensive GENERAL_ITEMS создает bias даже после union.

**Цена инфраструктуры.** Вручную поддерживать hero-role fallback builds и полноценную counter ontology одновременно — значительный контентный проект. Для малого стака лучше сначала поддержать часто встречающиеся герои и common effects, а не претендовать на 125×5 универсальную таблицу.

**Необходимое изменение.** Сравнить adaptive semantic coverage selector и несколько quota policies против baseline на **одинаковом K, token budget и времени**. Coverage by task: survival, dispel, catch, damage/farm, finish/hold; выбор корзин зависит от актуальных evidence. Include unknown role hypotheses; одна экономическая action может иметь несколько item implementations. Items filtered for mechanical admissibility before high-recall prompt. Hard protection редкого проверенного counter допустим, но не обещает priority/optimality.

**Kill-test.** Pareto curve K=6/12/24/32: допустимый action coverage, dominated/illegal rate, экспертная utility окончательного совета, latency/tokens. Если quota улучшила recall, но final useful-choice rate не вырос при равном бюджете — **отвергнуть квоты**, оставить union как набор источников. Fixture с шестью лучшими кандидатами одной категории и 2 дубликатами проверяет сам failure mode.

**Вердикт: revise.** Принцип «popularity — prior, не oracle» survives; квоты как рекомендуемая архитектура пока не обоснованы.

## DATA-3 — Turbo cohorts

**Сильнейший контрпример.** Все 30 соседей — один игрок на одном герое, одна party, один patch epoch. Формально count достаточный и human retrieval relevance 80%, но статистика отражает его привычку, а не хороший ориентир. Другой случай: retrieved 30 матчей с одинаковым gold/time/hero, но важные unknown facets, role и draft сильно меняют build. Медиана/IQR/n честные, однако подпись «нормальная экономика» ошибочно становится нормой игры.

**Future leakage.** Для ретроспективного role используют финальный farm/итоговый inventory; patch назначают по match timestamp без проверки client hotfix epoch; выбирают neighbors по final duration/win/completed build; 'decision time' строят из purchase logs без продажи, disassembly, backpack/courier и получения предметов. Даже `networth_by_minute` не доказывает точность inventory reconstruction. Match-start patch близко к update boundary может быть неверен, особенно длительный матч.

**Практическая доступность.** Production 403 parsed/501 API snapshots — не 403 независимых eligible примера на каждого героя. Последние30 подтверждают наличие timestamps, но явный patch0/30, event use sparse. Точный patch, достоверную роль и item-state timeline придется восстанавливать/верифицировать; это дороже простого nearest-neighbor UI.

**Ошибка go/no-go.** «≥30 на группу + 80% useful neighbors» — exploratory retrieval gate, не качество benchmark. Удобные соседи не говорят, что их builds разумны. Leave-one-match-out допускает одного игрока/вечер по обе стороны; time/patch drift не проверяется.

**Необходимое изменение.** Начать с собственного descriptive memory: «в похожих прошлых играх ты делал X, n=...», без слова норма. Независимый audit reconstruction в нескольких сложных матчах; test split whole sessions/patch windows, metadata about subject/party concentration. Отключать timing verdicts вообще до валидированного prospectively available state. Не блокировать advice из-за отсутствия cohorts.

**Kill-test.** Попытаться реконструировать 20 точек реальных матчей без доступа к будущим событиям и вручную сверить с replay UI. Затем удалить final role/duration/outcome/after-time features и измерить изменение neighbor/ranking. Если качество рушится или невозможно восстановить нужные поля — cohort-based recommendations **no-go**, остаются только архивные примеры. Если cohort не выигрывает у mechanics-only baseline в слепом сравнении, сложную retrieval инфраструктуру не строить.

**Вердикт: revise/deferred.** Cohort descriptive use допустим, timing norms не доказаны.

## DATA-4 — персональные повторяющиеся риски

**Сильнейший контрпример.** Три смерти без item-use записи, cooldown готов. Но BKB не спасал от piercing disable или прожим перед гарантированной смертью лишил бы его следующей защиты базы. Ненажатие было верным решением. Еще хуже sparse item_uses: отсутствие event интерпретируется как отсутствие действия; readiness неизвестен; last recorded backpack state устарел. Напоминание «опять забываешь BKB» психологически выглядит убедительно и подрывает доверие.

**Почему даже осторожная версия опасна.** Фраза «в нескольких эпизодах не зарегистрировано применение» логически может быть верна, но пользователю передает импликатуру «ты ошибся». Три independent episodes не дают baseline: при 100 подходящих opportunities это 3%, при 3 — 100%; opportunities сами требуют модели применимости. Для повторения важны не только разные match IDs, но один и тот же механический failure condition.

**Практическая цена.** Чтобы доказать missed opportunity, нужны item ready/usable, control states, damage/death timing, knowledge accessible player, counterfactual спасения/пользы, source completeness. Event presence audit этого не дает. В production item_uses у first player3/30 — очень слабое основание сейчас, и даже плотные логи не решают counterfactual.

**Необходимое изменение.** **Убрать из live v1**. Если исследовать, создавать postgame review candidates с явным вопросом «проверим эпизод?» и deep link к replay, а не персональные corrective reminders. Пользователь может сам подтвердить полезную привычку, после чего reminder хранится как его цель/предпочтение, не диагноз модели. Изучать простые подтверждаемые personal facts (предпочтенные герои/роль, выбранный игровой план) отдельно.

**Kill-test.** 20 случайно выбранных candidate episodes, не только найденных detector positives; два компетентных игрока оценивают пользу конкретного использования с полным replay и blind к detector. Если disagreement велик, readiness unknown или false-accusation>0, **не публиковать live claims**. Даже 20/20 не доказывает production precision; требуется контрольный negative набор и completeness validation.

**Вердикт: reject для live системы текущего этапа; research-only.** Severity fatal для доверия к советам при attribution личных ошибок. Не путать rejection с запретом любой персонализации.

## DATA-5 — decision journal

**Сильнейший контрпример.** Journal сохранил context JSON и revision IDs, но pinned source позже недоступен, normalization code обновился, модель у провайдера другая при том же имени. «Воспроизвести 100% решений» невозможно даже с temperature=0. Другой случай: output есть, но пользователь его никогда не увидел; eval считает совет принятой treatment. Или rejected advice не пишется — survivors-only quality выглядит идеально.

**Future leakage.** `availableAt` ошибочно назначается временем завершения матча, а внутри лежит early-time реконструкция с будущей информацией; min(eventTime, receivedAt) не исправляет фактическую доступность. Journal может честно архивировать уже утекший контекст. Отдельное хранение outcomes недостаточно, если candidate selector использовал final records до логирования.

**Цена.** Хранилище snapshot+proof+output на нашем объеме дешево. Полноценная event-sourced distributed система не нужна. append-only records с bounded retention и точными schema/version/artifact hashes достаточно; нельзя превратить «ledger» в самостоятельный квартальный проект.

**Необходимое изменение.** Определить replayability: точно восстановить **что система знала/послала/показала**, и детерминированно переиграть normalization/validators; не обещать byte-identical fresh LLM outputs. Сохранять payload/evidence blobs либо content-addressed references в нашем store, code/rule version, complete candidates, raw response, validator verdict, generation latency/usage, display channel/time and optional feedback. Sensitive не включать токены. All attempted/rejected decisions, not only success. Разделить `event occurred`, `observed by feed`, `available to advisor`, `generated`, `displayed`.

**Kill-test.** Отключить внешние API, обновить working code, восстановить 10 старых decisions из сохраненного bundle; compare original normalized input, approved claims and rendered output. Poison future event на этапе ingestion/selection, а не только в итоговой fixture: если output/context меняется до availableAt, no-go. Проверить одинаковый match не попал в train/test через другой snapshot.

**Вердикт: survive**, высокий приоритет. «Outputs reproducible» уточнить до auditable exact historical outputs + reproducible deterministic processing.

## DATA-6 — randomized live usefulness/causal benefit

**Сильнейший контрпример.** Стак учится из adaptive advice в понедельник, во вторник control baseline выигрывает за счет выученного знания. Match randomization не устраняет carryover. Один активный участник пересказывает советы группе; seen/accepted не измеряются надежно, self-reported usefulness зависит от результата матча. Выбирать switchback короткими блоками не делает эти эффекты независимыми.

**Ошибка критерия.** На 20–30 матчах «usefulness выше» может означать на один голос больше. Шум burden субъективен. Zero mechanically false на audited выборке — release screen, не доказательство нулевого риска. После множества метрик выбрать улучшившуюся — researcher degrees of freedom. Рандомизация дорогая по вниманию/организации именно там, где пока нет надежной mechanistic baseline.

**Необходимое изменение.** Сначала offline paired blind usefulness + opt-in shadow/live feasibility, **не causal superiority claim**. Если переходить к experiment: preregister primary target (например полезность решения до знания исхода), cluster at session/team, account carryover/history, record eligibility and display opportunity, stable baseline и одинаковый интерфейс. Intention-to-treat по assignment, missing feedback не 'not useful'. Учет отказов/abstentions обязателен: мало советов может artificially improve average rating.

**Kill-test.** Провести 5–10 feasibility сессий: способен ли пользователь дать blinded-ish feedback до исхода, измеряется ли exposure, нет ли контаминации между arms? Если нет — abandon causal trial framing, честно оставить descriptive UX feedback. Power/intervals до заявления superiority; victory uplift вне текущего scope. Если adaptive не превосходит templates offline, не тратить реальные матчи на статистику.

**Вердикт: revise/deferred.** Good methodological instinct, но сейчас больше ценности в контроле ошибок и полезности конкретного решения, чем treatment-effect infrastructure.

## DATA-7 — STRATZ capability spike

**Сильнейший контрпример.** Три известных своих матча доступны/разобраны, поэтому данные95% точные. Но 60% остальных Turbo matches отсутствуют, successful rows отобраны по privacy/parse policy; position выведена после игры, item timestamps имеют другую семантику, patch только major. API отличный для выбранных примеров, непригодный для cohort. «Авторизованный и разрешенный доступ» не означает доступ именно к нужным полям/достаточный лимит.

**Ошибка измерения.** 95% accuracy требует denominator и правила matching (timestamp tolerance, duplicate purchases, recipes, sold/disassembled items). Если считать только совпавшие positive events, пропуски не видны. Три матча могут включать сотни item events, но это не независимые тесты разных mode/hero/edge cases.

**Цена.** Spike действительно дешевый только при доступном auth и документированной schema. Если нужны переговоры, сложные коммерческие terms или scraping, это уже другой проект. Главный риск — новый provider слой не улучшает decision quality, зато дублирует уже имеющиеся403 replay.

**Необходимое изменение.** Перед запросами письменно перечислить конкретный недостающий capability и kill budget. Случайный небольшой sample своих known match IDs включая missing/private/старые/новые; отдельно request success, coverage, event precision/recall, timestamp semantics, current vs inferred role, patch granularity, licensed reuse and rate budget. Сравнить с собственным replay и вручную выбранными edge cases, не просто JSON equality. Не требовать весь graph если один raw endpoint решает задачу.

**Kill-test.** Если источник не дает нового проверяемого decision-time поля/сопоставимого Turbo cohort сверх нашей базы при допустимой цене, **не интегрировать**, даже если API технически работает. Если denominator/filter semantics не доказаны — не показывать статистику cohort. Три запроса могут доказать доступность; они не доказывают general correctness.

**Вердикт: survive как bounded spike**, не зависимость launch.

## Межгипотезные ловушки

1. DATA-1 проверяет форму данных, DATA-2 увеличивает recall, DATA-3 дает статистику, DATA-5 дает provenance — вместе это все еще не доказывает, что покупка полезна. Нужен независимый mechanics/application check и человеческий strategic benchmark.
2. DATA-5 дает хорошую базу eval только если построен **до** будущего контекста/кандидатов, иначе архивирует утечку без исправления.
3. DATA-4 не становится безопасным просто от richer DATA-7: позиционные/контрольные/ready-state события и counterfactual benefit — разные задачи.
4. Огромная база механик/векторов/cohorts может сделать маленький продукт неподдерживаемым. Первый сильный результат — узкий проверенный decision engine и честный отказ вне покрытия, а не все Dota-знания в одном prompt.
5. Любой go/no-go содержит отдельно: data validity, semantics correctness, useful-choice rate, meaningful coverage, operating cost. Нельзя компенсировать плохую семантику хорошей латентностью или высокий abstention красивой точностью.


## Дополнительная ROOT-атака: источник delay не доказывает лаг endpoint
Важное обязательное уточнение DATA-1/5: GC SourceTV game.delay=120 описывает nominal spectator delay, но без paired calibration нельзя утверждать, что GetRealtimeStats teams/game_time задержаны ровно настолько. Не вычислять actualLag=120+age как доказанный факт. Хранить происхождение поля и delaySemantics=uncalibrated, reported game time и receivedAt. Kill-test: согласованная серия сравнения игровых часов игрока и API с часовыми метками; до этого никакого SLA актуальности/тактических указаний на основании nominal delay. Provenance правильного поля без semantics correctness — классический пример ложной уверенности, которую DATA-1 должен ловить.
