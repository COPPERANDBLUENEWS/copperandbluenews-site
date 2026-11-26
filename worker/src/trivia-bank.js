// Curated Oilers trivia. Facts are finished events or dated snapshots, not live totals that move nightly.
// History, dynasty, and modern milestones follow data/history.json (each entry cites NHL.com, Hockey-Reference,
// NHL Records, or the Hockey Hall of Fame). Career totals that no longer change are the regular-season Oilers
// lines on records.nhl.com. The three "through 27 games" questions use data/mcdavid.json (NHL game log,
// updated 2026-11-26): McDavid's Nov. 24, 2026 line, plus the chase chart's Gretzky and 2022-23 comparables.
// Leon Draisaitl's 2014 draft slot and No. 29 are from data/players/8477934.json (NHL player landing).
const CATEGORIES = ["History", "Franchise Records", "Legends", "Modern Era", "By the Numbers"];

function q(id, category, prompt, choices, answer, fact) {
  return {id, category, prompt, choices, answer, fact};
}

export const QUESTIONS = [
  q("h-wha-four", "History", "Which four WHA clubs joined the NHL for the 1979-80 season?",
    ["Edmonton, Winnipeg, Quebec, and Hartford", "Edmonton, Calgary, Winnipeg, and Birmingham", "Edmonton, Quebec, Cincinnati, and Houston", "Edmonton, Winnipeg, New England, and Calgary"],
    0, "On March 30, 1979 the NHL voted in Edmonton, Winnipeg, Quebec, and Hartford, growing the league to 21 teams."),
  q("h-first-game", "History", "How did the Oilers' first NHL game, on Oct. 10, 1979, end?",
    ["A 4-2 win at Chicago", "A 4-2 loss at Chicago", "A 3-3 tie at home against Vancouver", "A 5-4 overtime win over the Canadiens"],
    1, "Edmonton opened NHL life with a 4-2 loss in Chicago. Kevin Lowe scored the franchise's first NHL goal."),
  q("h-first-goal", "History", "Who scored the first NHL goal in Oilers history?",
    ["Wayne Gretzky", "Mark Messier", "Kevin Lowe", "Blair MacDonald"],
    2, "Kevin Lowe, Edmonton's first NHL draft pick, scored it in the Oct. 10, 1979 opener at Chicago."),
  q("h-gretzky-arrives", "History", "The WHA Oilers acquired teenage Wayne Gretzky from which club?",
    ["The Birmingham Bulls", "The Indianapolis Racers", "The Winnipeg Jets", "The Houston Aeros"],
    1, "On Nov. 2, 1978 Edmonton got Gretzky, Peter Driscoll, and Eddie Mio from the Indianapolis Racers."),
  q("h-first-series", "History", "Edmonton's first NHL playoff series win was a sweep of which team?",
    ["The New York Islanders", "The Calgary Flames", "The Montreal Canadiens", "The Chicago Black Hawks"],
    2, "In April 1981 the Oilers swept Montreal 3-0 in the preliminary round, winning 6-3, 3-1, and 6-2."),
  q("h-cup-years", "History", "In which seasons did the Oilers win the Stanley Cup?",
    ["1983, 1984, 1985, 1987, and 1988", "1984, 1985, 1987, 1988, and 1990", "1984, 1985, 1986, 1988, and 1990", "1984, 1987, 1988, 1990, and 2006"],
    1, "Edmonton's five Cups came in 1984, 1985, 1987, 1988, and 1990. The 2006 and 2024-25 Final runs ended losses."),
  q("h-cup1-score", "History", "How did the Oilers clinch their first Stanley Cup on May 19, 1984?",
    ["5-2 over the Islanders in Game 5 at Northlands Coliseum", "4-1 over the Islanders in Game 7 at Nassau Coliseum", "4-0 sweep of the Flyers", "3-1 over Boston in Game 7"],
    0, "Edmonton beat the four-time champion Islanders 5-2 in Game 5 at home. Mark Messier won the Conn Smythe."),
  q("h-cup1-smythe", "History", "Who won the Conn Smythe Trophy when the Oilers won the Cup in 1984?",
    ["Wayne Gretzky", "Grant Fuhr", "Mark Messier", "Paul Coffey"],
    2, "Messier was playoff MVP in 1984. Gretzky won the Conn Smythe in 1985 and again in 1988."),
  q("h-cup2", "History", "Who did the Oilers beat for their second straight Cup in 1985, and who was playoff MVP?",
    ["The Islanders, with Billy Smith the MVP", "The Flyers, with Gretzky winning the Conn Smythe", "The Flames, with Jari Kurri the MVP", "The Bruins, with Grant Fuhr the MVP"],
    1, "An 8-3 win over Philadelphia in Game 5 on May 30, 1985 made it back-to-back titles. Gretzky won the Conn Smythe."),
  q("h-cup3", "History", "What was the score of Game 7 of the 1987 Stanley Cup Final?",
    ["Oilers 3, Flyers 1", "Oilers 4, Flyers 2", "Flyers 4, Oilers 3", "Oilers 5, Bruins 2"],
    0, "On May 31, 1987 Edmonton won Game 7 at home, 3-1 over Philadelphia, for Cup number three."),
  q("h-power-out", "History", "Why was Game 4 of the 1988 Final never finished?",
    ["A fog delay at Northlands Coliseum", "A power failure at Boston Garden with the score 3-3", "A referee strike in the second period", "The series was already over after three games"],
    1, "Play stopped at 3-3 in the second period on May 24, 1988. Edmonton still led 3-0 and won the Cup at home, 6-3."),
  q("h-cup5", "History", "The Oilers' fifth Cup, in 1990, was their first without Gretzky. Who won the Conn Smythe?",
    ["Mark Messier", "Bill Ranford", "Craig MacTavish", "Grant Fuhr"],
    1, "Edmonton beat Boston 4-1 in Game 5 on May 24, 1990. Goaltender Bill Ranford was playoff MVP."),
  q("h-1990-coach", "History", "Who coached the Oilers to the 1990 Stanley Cup?",
    ["Glen Sather", "John Muckler", "Ted Green", "Ron Low"],
    1, "John Muckler was the head coach in 1990. Glen Sather had coached the 1984, 1985, 1987, and 1988 Cup teams."),
  q("h-trade-date", "History", "On what date was Wayne Gretzky traded from Edmonton to Los Angeles?",
    ["August 9, 1988", "July 1, 1988", "October 15, 1989", "June 23, 1988"],
    0, "The Aug. 9, 1988 trade sent Gretzky, Marty McSorley, and Mike Krushelnyski to the Kings."),
  q("h-heritage", "History", "The NHL's first regular-season outdoor game, the 2003 Heritage Classic, drew how many fans?",
    ["41,000 at Northlands Coliseum", "57,167 at Commonwealth Stadium", "32,000 at Commonwealth Stadium", "105,000 at the University of Alberta"],
    1, "On Nov. 22, 2003, Montreal beat Edmonton 4-3 in front of a record 57,167 at Commonwealth Stadium."),
  q("h-darkness", "History", "How many straight seasons did the Oilers miss the playoffs in the stretch fans call the Decade of Darkness?",
    ["6, from 2007 to 2012", "8, from 2008 to 2015", "10, from 2006-07 through 2015-16", "12, from 2004 to 2016"],
    2, "After the 2006 Final they missed the playoffs for 10 straight seasons, returning in 2017."),

  q("l-fifty-39", "Legends", "Gretzky reached 50 goals in Edmonton's 39th game of 1981-82. What happened that night?",
    ["He scored once in a 3-1 win at Montreal", "He scored five times in a 7-5 win over Philadelphia", "He scored twice in a 5-4 loss to the Islanders", "He had seven assists against Los Angeles"],
    1, "On Dec. 30, 1981 at Northlands Coliseum, five goals against the Flyers made it 50 in 39 games."),
  q("l-92", "Legends", "How many goals did Wayne Gretzky score in 1981-82, still the NHL single-season record?",
    ["76", "87", "92", "215"],
    2, "He scored 92 goals in 80 games. Phil Esposito's old mark was 76. Gretzky also had 120 assists for 212 points."),
  q("l-212", "Legends", "Gretzky's 92-goal season produced how many points?",
    ["196", "205", "212", "215"],
    2, "1981-82 was 92 goals and 120 assists, 212 points. The 215-point season came four years later."),
  q("l-215", "Legends", "Which single-season line is still the NHL record for assists and points?",
    ["73 goals and 135 assists in 1984-85", "52 goals and 163 assists in 1985-86", "87 goals and 118 assists in 1983-84", "62 goals and 121 assists in 1986-87"],
    1, "In 1985-86 Gretzky had 52 goals and 163 assists for 215 points in 80 games. Both the assist and point marks still stand."),
  q("l-streak", "Legends", "Gretzky's NHL-record point streak in 1983-84 lasted how many games, and how many points did he put up during it?",
    ["39 games and 108 points", "46 games and 103 points", "51 games and 153 points", "61 games and 92 points"],
    2, "He had a point in each of the first 51 games, Oct. 5, 1983 through Jan. 27, 1984: 61 goals and 92 assists, 153 points."),
  q("l-coffey-48", "Legends", "Paul Coffey's 1985-86 goal total is still the NHL record for a defenceman. How many did he score?",
    ["37", "46", "48", "54"],
    2, "Coffey broke Bobby Orr's 46 and finished with 48 goals and 90 assists, 138 points, in 79 games."),
  q("l-orr", "Legends", "Whose defenceman goal record did Paul Coffey break in 1985-86?",
    ["Bobby Orr's 46", "Denis Potvin's 31", "Ray Bourque's 31", "Doug Wilson's 39"],
    0, "Orr's 46 goals in 1974-75 had been the record. Coffey passed it and finished the year with 48."),
  q("l-kurri-71", "Legends", "How many goals did Jari Kurri score for the Oilers in 1984-85?",
    ["54", "68", "71", "87"],
    2, "Kurri had 71 goals and 64 assists in 73 games. The only higher Oilers seasons are Gretzky's 92, 87, and 73."),
  q("l-fuhr-vezina", "Legends", "When did Grant Fuhr win the Vezina Trophy?",
    ["1983-84", "1985-86", "1987-88", "1989-90"],
    2, "Fuhr won the Vezina in 1987-88 after starting 75 games, going 40-24-9, and helping Edmonton to the Cup."),
  q("l-fuhr-gp", "Legends", "How many games did Grant Fuhr play in his Vezina season of 1987-88?",
    ["64", "70", "75", "80"],
    2, "Fuhr appeared in 75 games, 73 of them starts, on the way to the Vezina and the 1988 Cup."),
  q("l-fuhr-wins", "Legends", "How many wins did Grant Fuhr record in 1987-88?",
    ["32", "36", "40", "44"],
    2, "He went 40-24-9 in 75 games, with a 3.43 goals-against average and four shutouts."),
  q("l-messier-trade", "Legends", "After he captained the 1990 Cup team, Mark Messier was traded to which club?",
    ["The Boston Bruins", "The New York Rangers", "The Vancouver Canucks", "The Los Angeles Kings"],
    1, "On Oct. 4, 1991 Edmonton sent its captain to the Rangers for Bernie Nicholls, Steven Rice, and Louie DeBrusk."),
  q("l-trade-with", "Legends", "Who went to Los Angeles with Gretzky in the Aug. 9, 1988 trade?",
    ["Jari Kurri and Esa Tikkanen", "Marty McSorley and Mike Krushelnyski", "Paul Coffey and Charlie Huddy", "Mark Messier and Kevin Lowe"],
    1, "McSorley and Krushelnyski joined Gretzky. Edmonton received Jimmy Carson, Martin Gelinas, three first-round picks, and $15 million."),
  q("l-trade-back", "Legends", "Which centre came to Edmonton from Los Angeles in the Gretzky trade?",
    ["Bernie Nicholls", "Jimmy Carson", "Craig Simpson", "Doug Weight"],
    1, "Jimmy Carson was the roster centre in the return, along with prospect Martin Gelinas, three first-round picks, and $15 million."),
  q("l-howe", "Legends", "On Oct. 15, 1989, playing for the Kings at Northlands Coliseum, Gretzky passed Gordie Howe with which point?",
    ["Point number 1,850, an empty-net goal", "Point number 1,851, tying the game with 53 seconds left", "Point number 1,669, an assist on Marty McSorley", "Point number 2,000, in overtime"],
    1, "He tied the score with 53 seconds left for career point 1,851, passing Howe's NHL regular-season record in the building he used to fill."),
  q("l-lowe-hof", "Legends", "Kevin Lowe's 2020 Hall of Fame election made him the seventh dynasty Oiler inducted. Who were the first six?",
    ["Gretzky, Messier, Kurri, Coffey, Anderson, and Fuhr", "Gretzky, Messier, Kurri, Coffey, Sather, and Fuhr", "Gretzky, Messier, Kurri, Huddy, Anderson, and Fuhr", "Gretzky, Messier, Tikkanen, Coffey, Anderson, and Fuhr"],
    0, "Lowe joined Wayne Gretzky, Mark Messier, Jari Kurri, Paul Coffey, Glenn Anderson, and Grant Fuhr."),

  q("f-446", "Franchise Records", "The Oilers' 446 goals in 1983-84 are the most by any team in an NHL season. How many games did that take?",
    ["70", "80", "82", "84"],
    1, "Edmonton scored 446 goals in 80 games, 5.58 per game. That team mark still leads the NHL record book."),
  q("f-583", "Franchise Records", "Wayne Gretzky's regular-season goal total with the Oilers is the franchise record. How many did he score?",
    ["474", "583", "696", "894"],
    1, "In 696 Oilers games he had 583 goals, 1,086 assists, and 1,669 points. The 894 is his career goal total with every team."),
  q("f-1086", "Franchise Records", "How many regular-season assists did Gretzky record as an Oiler?",
    ["642", "856", "1,086", "1,963"],
    2, "1,086 assists in an Oilers uniform. His NHL career assist total, 1,963, includes Los Angeles, St. Louis, and the Rangers."),
  q("f-1669", "Franchise Records", "How many regular-season points did Gretzky score for Edmonton?",
    ["1,034", "1,279", "1,669", "2,857"],
    2, "583 goals plus 1,086 assists is 1,669 points. That remains the Oilers' career record by a wide margin."),
  q("f-696", "Franchise Records", "How many regular-season games did Wayne Gretzky play for the Oilers?",
    ["424", "696", "851", "1,487"],
    1, "He played 696 regular-season games in Edmonton, from 1979-80 through 1987-88. His full NHL career was 1,487 games."),
  q("f-kurri-goals", "Franchise Records", "How many regular-season goals did Jari Kurri score for the Oilers?",
    ["417", "474", "569", "1,043"],
    1, "Kurri's Oilers line was 754 games, 474 goals, 569 assists, and 1,043 points. The 474 is a finished career total."),
  q("f-messier-pts", "Franchise Records", "How many regular-season points did Mark Messier score for the Oilers?",
    ["906", "1,034", "1,043", "1,887"],
    1, "Messier's Edmonton regular-season line was 851 games, 392 goals, 642 assists, and 1,034 points."),
  q("f-anderson-54", "Franchise Records", "How many goals did Glenn Anderson score in 1985-86?",
    ["48", "54", "68", "71"],
    1, "Anderson had 54 goals and 48 assists in 72 games. Kurri had 68 that year, and Gretzky 52."),
  q("f-coffey-138", "Franchise Records", "Paul Coffey's 48-goal season produced how many points?",
    ["121", "126", "138", "215"],
    2, "48 goals and 90 assists is 138 points in 1985-86, one point shy of Bobby Orr's defenceman record of 139."),
  q("f-99", "Franchise Records", "Whose number 99 did the Oilers retire on Oct. 1, 1999?",
    ["Wayne Gretzky", "Mark Messier", "Jari Kurri", "Paul Coffey"],
    0, "Edmonton raised 99 before the home opener against the Rangers, months before the NHL retired it league-wide."),
  q("f-11", "Franchise Records", "Which Oilers number belongs to Mark Messier?",
    ["9", "11", "14", "17"],
    1, "Messier wore 11. Glenn Anderson's 9 and Jari Kurri's 17 are also retired."),
  q("f-17", "Franchise Records", "Which retired Oilers number belongs to Jari Kurri?",
    ["7", "14", "17", "27"],
    2, "Kurri's retired number is 17. Paul Coffey's is 7."),
  q("f-7", "Franchise Records", "Whose No. 7 is retired by the Oilers?",
    ["Paul Coffey", "Glen Sather", "Esa Tikkanen", "Al Hamilton"],
    0, "Coffey's retired number is 7. Al Hamilton's is 3."),
  q("f-31", "Franchise Records", "Whose No. 31 is in the Oilers' rafters?",
    ["Bill Ranford", "Andy Moog", "Grant Fuhr", "Curtis Joseph"],
    2, "Grant Fuhr's retired number is 31. Bill Ranford, the 1990 Conn Smythe winner, is not the name on 31."),
  q("f-9", "Franchise Records", "Whose No. 9 did the Oilers retire?",
    ["Glenn Anderson", "Norm Ullman", "Bernie Nicholls", "Ryan Smyth"],
    0, "Glenn Anderson's retired number is 9. Ryan Smyth's 94 was never retired."),
  q("f-4", "Franchise Records", "On Nov. 5, 2021 the Oilers retired which number for Kevin Lowe?",
    ["2", "4", "5", "6"],
    1, "Lowe's No. 4 joined Anderson, Coffey, Fuhr, Gretzky, Kurri, and Messier in the Rogers Place rafters."),
  q("f-3", "Franchise Records", "Whose No. 3 was the first number the Oilers retired?",
    ["Al Hamilton", "Kevin Lowe", "Lee Fogolin", "Ron Low"],
    0, "Al Hamilton, a WHA-era defenceman, is the player honored by retired No. 3. NHL Records lists that number with his name."),

  q("m-mcdavid-draft", "Modern Era", "Where was Connor McDavid drafted, and from which junior team?",
    ["First overall in 2015, from the Erie Otters", "First overall in 2014, from the London Knights", "Third overall in 2015, from the Erie Otters", "First overall in 2012, from the Sarnia Sting"],
    0, "On June 26, 2015 Edmonton took McDavid first overall after he had played for the Erie Otters."),
  q("m-lottery", "Modern Era", "What did the 2015 draft lottery do to Edmonton's pick before McDavid was selected?",
    ["It dropped the Oilers from first to third", "It moved them from third up to first", "It left them at second", "Edmonton traded into the top pick"],
    1, "Edmonton jumped from third to first in the lottery, then selected McDavid two months later."),
  q("m-leo-draft", "Modern Era", "Where did the Oilers draft Leon Draisaitl?",
    ["First overall in 2014", "Third overall in 2014", "Third overall in 2015", "Seventh overall in 2013"],
    1, "Edmonton took Draisaitl third overall in 2014, one year before McDavid. The NHL player file lists that pick."),
  q("m-three-firsts", "Modern Era", "Edmonton picked first overall three years running from 2010 to 2012. Who were those picks, in order?",
    ["Taylor Hall, Ryan Nugent-Hopkins, and Nail Yakupov", "Taylor Hall, Nail Yakupov, and Ryan Nugent-Hopkins", "Ryan Nugent-Hopkins, Taylor Hall, and Nail Yakupov", "Taylor Hall, Jordan Eberle, and Nail Yakupov"],
    0, "Hall in 2010, Nugent-Hopkins in 2011, and Yakupov in 2012. Eberle was a 2008 first-rounder, 22nd overall."),
  q("m-captain-age", "Modern Era", "How old was Connor McDavid when he was named Oilers captain on Oct. 5, 2016?",
    ["18 years and 266 days", "19 years and 266 days", "20 years and 100 days", "21 years exactly"],
    1, "At 19 years and 266 days he became the youngest captain in NHL history."),
  q("m-rogers-open", "Modern Era", "What happened in the first regular-season game at Rogers Place?",
    ["Edmonton lost 4-1 to Calgary", "Edmonton beat Calgary 7-4, and McDavid scored twice", "Edmonton beat Vancouver 6-2", "The game was postponed by a power failure"],
    1, "On Oct. 12, 2016 the Oilers opened downtown with a 7-4 win over the Flames. McDavid scored two of the goals."),
  q("m-rexall-last", "Modern Era", "Who did the Oilers beat in their final game at Rexall Place?",
    ["The Calgary Flames, 7-4", "The Vancouver Canucks, 6-2", "The Los Angeles Kings, 3-2", "The San Jose Sharks, 4-1"],
    1, "On April 6, 2016 Edmonton closed the old Northlands Coliseum, by then Rexall Place, with a 6-2 win over Vancouver."),
  q("m-2017-awards", "Modern Era", "McDavid's 100-point 2016-17 season earned which awards, as Edmonton returned to the playoffs?",
    ["The Calder, Hart, and Art Ross", "The Art Ross, Hart, and Ted Lindsay", "The Hart only", "The Rocket Richard and the Norris"],
    1, "He won the Art Ross, the Hart, and the Ted Lindsay. It was his second NHL season, so he was not Calder-eligible. The Oilers' previous playoff trip had been 2006."),
  q("m-2017-line", "Modern Era", "What was McDavid's goal and assist line in that 100-point 2016-17 season?",
    ["30 goals and 70 assists", "41 goals and 59 assists", "44 goals and 56 assists", "50 goals and 50 assists"],
    0, "He had 30 goals and 70 assists for 100 points, 11 ahead of Sidney Crosby's 89."),
  q("m-leo-hart", "Modern Era", "Leon Draisaitl's 2019-20 season made him the first Germany-born winner of which trophy, on the way to 110 points?",
    ["The Norris Trophy", "The Hart Trophy", "The Vezina Trophy", "The Calder Trophy"],
    1, "Draisaitl led the NHL with 110 points and won the Art Ross, the Ted Lindsay, and the Hart."),
  q("m-leo-110", "Modern Era", "What was Draisaitl's 2019-20 scoring line?",
    ["50 goals and 60 assists in 82 games", "43 goals and 67 assists in 71 games", "34 goals and 76 assists in 68 games", "52 goals and 58 assists in 80 games"],
    1, "43 goals and 67 assists, 110 points in 71 games, 13 points clear of McDavid's 97."),
  q("m-unanimous", "Modern Era", "In the 56-game 2020-21 season, McDavid won the Hart with all 100 first-place votes. How many points did he score?",
    ["97", "100", "105", "153"],
    2, "He had 105 points in 56 games. The Hart vote was unanimous, 100 first-place votes."),
  q("m-boa", "Modern Era", "On May 26, 2022, McDavid's overtime goal did what?",
    ["Eliminated Calgary 5-4 in Game 5 and sent Edmonton to its first conference final since 2006", "Won the Stanley Cup in Game 7", "Completed a sweep of Dallas", "Clinched the Presidents' Trophy"],
    0, "His overtime winner made it 5-4 in Game 5 of the Battle of Alberta. Edmonton went on to the conference final for the first time since 2006."),
  q("m-153", "Modern Era", "McDavid's 2022-23 season finished with which totals, and which goal award to go with the Art Ross and Hart?",
    ["64 goals and 153 points, plus the Rocket Richard", "55 goals and 128 points, plus the Selke", "50 goals and 140 points, plus the Conn Smythe", "48 goals and 138 points, plus the Rocket Richard"],
    0, "64 goals and 89 assists, 153 points in 82 games. He won the Art Ross, the Rocket Richard, and the Hart. It was the most points in a season since 1995-96."),
  q("m-streak-16", "Modern Era", "Edmonton's 16-game winning streak in 2023-24 ended where, and how does 16 rank?",
    ["At home against Calgary; the longest streak ever", "In Vegas; tied for the second-longest in NHL history, one short of Pittsburgh's 17", "In Colorado; the third-longest, six short of the record", "In Boston; it broke the NHL record"],
    1, "The streak, under Kris Knoblauch (hired Nov. 12, 2023), ended in Vegas on Feb. 6, 2024. Pittsburgh's 17 in 1992-93 is the record."),
  q("m-100-assists", "Modern Era", "On April 15, 2024, McDavid became the fourth player with 100 assists in a season. Who did he set up for the milestone, and who were the first three?",
    ["Leon Draisaitl; Howe, Orr, and Gretzky", "Zach Hyman; Gretzky, Lemieux, and Orr", "Ryan Nugent-Hopkins; Gretzky, Lemieux, and Bourque", "Zach Hyman; Gretzky, Messier, and Lemieux"],
    1, "He set up Zach Hyman in a 9-2 win over San Jose. Only Gretzky, Mario Lemieux, and Bobby Orr had reached 100 assists in a season before him."),

  q("n-132", "By the Numbers", "McDavid's 2023-24 regular season, the year of the 100-assist campaign, ended at which line?",
    ["32 goals, 100 assists, and 132 points in 76 games", "48 goals, 90 assists, and 138 points in 82 games", "64 goals, 89 assists, and 153 points in 82 games", "26 goals, 74 assists, and 100 points in 67 games"],
    0, "He played 76 games, with 32 goals and 100 assists for 132 points. The 138-point year was 2025-26."),
  q("n-smythe-42", "By the Numbers", "McDavid won the 2024 Conn Smythe after Edmonton lost the Final. How many playoff points did he have?",
    ["34 points in 25 games", "42 points in 25 games", "47 points in 18 games", "31 points in 22 games"],
    1, "He had 8 goals and 34 assists, 42 points in 25 games. The Oilers lost Game 7 in Florida, 2-1."),
  q("n-34-assists", "By the Numbers", "McDavid's 34 assists in the 2024 playoffs were a record. Where did the 42 points rank against earlier postseasons?",
    ["Only Gretzky and Mario Lemieux had more points in one playoff year", "It broke Gretzky's playoff point record", "It tied Messier's 1994 total", "It was the first 40-point playoff year since 2010"],
    0, "The 34 assists were a record. The 42 points put him with Gretzky and Lemieux as the only players with 40 or more in one postseason."),
  q("n-game7-2024", "By the Numbers", "The 2024 Stanley Cup Final ended how, after Edmonton trailed 3-0?",
    ["Edmonton won Game 7 at Rogers Place, 3-2", "Florida won Game 7, 2-1", "Florida won Game 6, 5-1", "Edmonton won Game 6 in overtime"],
    1, "The Oilers forced Game 7, then lost 2-1 in Florida on June 24, 2024. The 5-1 Game 6 was the 2025 rematch."),
  q("n-1000-pts", "By the Numbers", "McDavid scored his 1,000th NHL point on Nov. 14, 2024 against Nashville. In which game of his career?",
    ["His 424th game", "His 659th game", "His 757th game", "His 1,000th game"],
    1, "He reached 1,000 points in his 659th game. Only Gretzky, Lemieux, and Mike Bossy had done it faster."),
  q("n-2025-final", "By the Numbers", "How did the 2025 Stanley Cup Final between Florida and Edmonton end?",
    ["Florida won in seven, taking Game 7 by 2-1", "Florida won in six, taking Game 6 by 5-1", "Edmonton won in six", "Florida swept the series"],
    1, "After Edmonton beat Dallas in five to return to the Final, Florida won the rematch 4-2. Game 6 on June 17, 2025 was 5-1."),
  q("n-extension", "By the Numbers", "On Oct. 6, 2025, McDavid signed an extension with what term and average annual value?",
    ["Eight years at $12.5 million", "Two years at $12.5 million", "Two years at $10 million", "Five years at $14 million"],
    1, "The captain signed a two-year extension with a $12.5 million average annual value."),
  q("n-leo-1000", "By the Numbers", "Leon Draisaitl reached 1,000 NHL points on Dec. 16, 2025. What was notable about it?",
    ["He was the first German player to 1,000, in a 6-4 win over Pittsburgh", "He was the fastest Oiler to 1,000, in a 3-2 win over Calgary", "He did it on a hat trick against Vancouver", "He passed Gretzky's Oilers point total the same night"],
    0, "Draisaitl became the first German player with 1,000 NHL points in a 6-4 win over Pittsburgh."),
  q("n-rnh-1000", "By the Numbers", "Ryan Nugent-Hopkins played his 1,000th NHL game on Jan. 18, 2026. What happened?",
    ["He was a healthy scratch in a loss to Colorado", "He scored in a 5-0 win over St. Louis, every game of the 1,000 with Edmonton", "He recorded his 1,000th point against Vegas", "He was traded that morning"],
    1, "He scored in his 1,000th game, all of them in an Oilers sweater, in a 5-0 win over St. Louis."),
  q("n-400-1200", "By the Numbers", "On March 24, 2026 at Utah, McDavid hit which two milestones in the same game?",
    ["His 300th goal and 1,000th point", "His 400th goal and 1,200th point", "His 500th goal and 1,500th point", "His 100th playoff point and 400th assist"],
    1, "He scored twice for his 400th goal and 1,200th point, and became the third-fastest player to 1,200 points."),
  q("n-sixth-ross", "By the Numbers", "McDavid's sixth Art Ross Trophy, won in 2025-26, came with which season line?",
    ["48 goals and 138 points, and a point in all 41 Oilers wins", "64 goals and 153 points", "32 goals and 132 points", "26 goals and 100 points in 67 games"],
    0, "He finished 2025-26 with 48 goals, 90 assists, and 138 points in 82 games, and he had a point in every Edmonton win."),
  q("n-round1-2026", "By the Numbers", "How did the Oilers' 2026 playoff run end?",
    ["A second-round loss to Dallas in seven", "A first-round loss to Anaheim, 4-2, with Game 6 a 5-2 Ducks win", "A Final loss to Florida in six", "A first-round sweep by Los Angeles"],
    1, "Anaheim won Game 6 by 5-2 on April 30, 2026 and took the series 4-2, Edmonton's earliest exit since 2021."),
  q("n-babcock", "By the Numbers", "Who did the Oilers hire as head coach on June 23, 2026, after firing Kris Knoblauch?",
    ["Jay Woodcroft", "Glen Sather", "Mike Babcock", "Todd McLellan"],
    2, "Knoblauch was fired after three seasons and two Cup Final trips. Mike Babcock was hired six weeks later."),
  q("n-live-59", "By the Numbers", "Through Edmonton's Nov. 24, 2026 game against Vegas, McDavid's 27th game of 2026-27, how many points did he have?",
    ["45", "52", "59", "64"],
    2, "The NHL game log on the site's McDavid Chase page has him at 14 goals and 45 assists, 59 points, through that game."),
  q("n-gretzky-27", "By the Numbers", "On that same chase chart, how many points did Gretzky have through 27 games of his 215-point season?",
    ["52", "59", "64", "92"],
    2, "The chart's 1985-86 game log has Gretzky at 64 points through 27 games. McDavid was at 59 through 27 in 2026-27."),
  q("n-best-27", "By the Numbers", "The chase chart's 'career best through 27 games' for McDavid is his 2022-23 start. How many points was that?",
    ["48", "52", "59", "64"],
    1, "Through 27 games of 2022-23 he had 52 points. He finished that year with 153."),
  q("n-draft-1979", "By the Numbers", "In the Oilers' first NHL draft, in 1979, where were Kevin Lowe, Mark Messier, and Glenn Anderson selected?",
    ["Lowe 21st, Messier 48th, Anderson 69th", "Lowe 1st, Messier 3rd, Anderson 9th", "Lowe 12th, Messier 21st, Anderson 48th", "Messier 1st, Lowe 21st, Anderson 22nd"],
    0, "All three became Hall of Famers: Lowe 21st overall, Messier 48th, and Anderson 69th."),
  q("n-pisani", "By the Numbers", "Fernando Pisani's goal in Game 5 of the 2006 Final was the first of its kind. What was it?",
    ["The first penalty shot in a Final", "The first shorthanded overtime goal in Final history, 3:31 into OT", "The first empty-net goal of the series", "A five-goal game"],
    1, "Pisani scored shorthanded 3:31 into overtime on June 14, 2006, and Edmonton won Game 5 at Carolina, 4-3."),
  q("n-game7-2006", "By the Numbers", "How did the Oilers' 2006 Stanley Cup Final end?",
    ["A 3-1 loss to the Hurricanes in Game 7 in Raleigh", "A 4-2 win over Carolina in Game 6", "A 2-1 loss to Detroit in Game 7", "A sweep by the Hurricanes"],
    0, "On June 19, 2006 Carolina won Game 7, 3-1, at RBC Center. Edmonton had been the West's No. 8 seed."),
  q("n-eighth-seed", "By the Numbers", "In 2006 the eighth-seeded Oilers knocked out the top-seeded Red Wings. How did that series end?",
    ["Edmonton won 4-2, taking Game 6 by 4-3", "Edmonton swept Detroit", "Detroit won Game 7 in overtime", "Edmonton won 4-1"],
    0, "Edmonton beat Detroit 4-3 in Game 6 on May 1, 2006 and took the series 4-2."),
  q("n-cup4-score", "By the Numbers", "After the 1988 power outage, what was the score when the Oilers finished the sweep?",
    ["3-1 over Boston", "4-2 over Boston", "6-3 over Boston", "5-2 over the Islanders"],
    2, "With the suspended game left unreplayed, Edmonton beat the Bruins 6-3 at home on May 26, 1988. Gretzky won his second Conn Smythe."),
  q("n-sweater-29", "By the Numbers", "What sweater number does Leon Draisaitl wear for the Oilers?",
    ["19", "29", "39", "97"],
    1, "Draisaitl wears 29. McDavid wears 97. The number is the one on the club's 2026-27 NHL player file."),
];

const byId = new Map(QUESTIONS.map(item => [item.id, item]));

export function questionById(id) {
  return byId.get(id) || null;
}

export function categories() {
  return CATEGORIES.slice();
}

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

// Spread categories so a 10-question run is not ten versions of the same fact.
export function pickQuestionIds(n = 10, random = Math.random) {
  const buckets = new Map();
  for (const item of QUESTIONS) {
    if (!buckets.has(item.category)) buckets.set(item.category, []);
    buckets.get(item.category).push(item.id);
  }
  for (const list of buckets.values()) shuffle(list, random);
  const cats = shuffle([...buckets.keys()], random);
  const picked = [];
  while (picked.length < n) {
    let moved = false;
    for (const cat of cats) {
      const list = buckets.get(cat);
      if (!list.length) continue;
      picked.push(list.pop());
      moved = true;
      if (picked.length === n) break;
    }
    if (!moved) break;
  }
  return picked;
}

export function publicQuestion(item) {
  return {id: item.id, category: item.category, prompt: item.prompt, choices: item.choices.slice()};
}

export function assertBank() {
  const ids = new Set();
  const prompts = new Set();
  if (QUESTIONS.length < 80) throw new Error("bank is short: " + QUESTIONS.length);
  for (const item of QUESTIONS) {
    if (!CATEGORIES.includes(item.category)) throw new Error("bad category " + item.id);
    if (ids.has(item.id) || prompts.has(item.prompt)) throw new Error("duplicate " + item.id);
    ids.add(item.id);
    prompts.add(item.prompt);
    if (!Array.isArray(item.choices) || item.choices.length !== 4) throw new Error("choices " + item.id);
    if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer > 3) throw new Error("answer " + item.id);
    if (new Set(item.choices).size !== 4) throw new Error("repeat choice " + item.id);
    if (typeof item.fact !== "string" || item.fact.length < 20) throw new Error("fact " + item.id);
    if (item.choices.some(choice => typeof choice !== "string" || !choice.trim())) throw new Error("blank choice " + item.id);
  }
  for (const cat of CATEGORIES) {
    if (!QUESTIONS.some(item => item.category === cat)) throw new Error("missing " + cat);
  }
}
