In 1903, the Wright brothers had their first successful flight in Kitty Hawk, North Carolina for a whopping 12 seconds. In roughly 10 years at the outbreak of World War I, machine guns were already mounted on planes and timed to fire through the single propeller directly in front of the pilot. In 20 years after the first World War, the second World War would break out, and to this day, be the conflict that has involved the most aircraft. To understand how aircraft were used and to examine the movement and patterns of planes on a larger scale, we seek to chart the movement of bombing, cargo, and reconnaissance groups to create a visual timelapse representation of the larger air strategy in East Asia. The inspiration for this project stemmed from looking at the movement of ships representing trade routes and looking at flightradar24, a web app that uses satellite information to broadcast real time position as well as start destination and end destination for all aircraft currently in the air.
Our project seeked to launch the initiative in two specific aspects of charting flights in WWII in the Pacific Theater. First, we start with the smaller, more granular level, where we are looking at individual logbooks, punching in coordinates for a specific aircraft, and doing this for a short period of time. For this portion of the project, we went to the National Archives at College Park, Maryland and found a relevant bomber group, the 12th bomber group which was part of the tenth Air Force that was active in the Pacific during the China-India-Burma Campaign. We initially wanted to have the project document every single individual flight that was present in the logbooks, but we quickly discovered there were far too many documents for us to parse. So, we reduced scope and did a singular month for a singular bomber group and still had hundreds of sorties to chart. 
On the other hand, our project seeks to tackle group and squadron history. This was done in the form of following an entire bombardment group or reconnaissance group, looking at their squadron history, tracing how they relocated, seeing when the group or squadron as a whole goes on a raid. The idea behind tracing the group data was that sometimes when things are too granular, it is hard to see the larger picture. The same idea as focusing on the leaf allows the viewer to miss the tree and the forest. The primary source that we drew from for this portion of the project is the seven volume series known as The Army Air Forces in World War II. This extensive volume covers the organization, strategy, and combat operations of American air power across all major theaters of the war, from Europe and the Mediterranean to the Pacific. Our project primarily pulls from volumes 4 and 5. However, some of our earlier flights also do pull from the earlier volumes. From this seven volume series, each one roughly being 900 pages, another document known as U.S. Army Air Forces in World War II Combat Chronology 1941 - 1945 was compiled from the seven volume series. We use this document to create our macroscale digital object. In this collection, we have documentation of all the major numbered air forces and strategic commands either performing raids, or relocating their groups and squadrons around.
This project fundamentally operates within a constructivist ontological framework, proceeding from the recognition that historical reality cannot be perfectly reconstructed due to the inherent incompleteness and disparateness of the available source material. Rather than attempting a definitive reconstruction of events, the aim of this project was to approximate, at a reasonable level of fidelity, the sortie data of the 12th Bombardment Group alongside the macro-level strategic campaigns of the broader Pacific Theater. This approximation was necessitated, in part, by the pervasive incompleteness of the primary sources themselves. Individual sortie reports, for instance, typically recorded time of departure and time of return, with only intermittent geographic references embedded within mission notes — occasional mentions of coastlines, landmarks, or positional markers that, when mapped onto contemporary cartography, resist precise recreation. The Burma Campaign presents a particularly illustrative case: bombardment groups operating in that theater were frequently tasked with neutralizing bridge infrastructure in order to degrade Japanese ground force logistics. However, the available records offer no reliable means of determining the precise moment at which an aircraft reversed course, nor do they account for deviations from the intended flight path — whether attributable to meteorological conditions, navigational error, or tactical adjustment. The resulting flight reconstructions are therefore approximations, intended to illuminate broader historical patterns rather than replicate the precise sequence of events.
Further complicating our analysis is how reliable our source was. Military documentation can be subject to institutional pressures that may have introduced systematic biases into the record. Given the expectation that personnel adhere closely to prescribed mission parameters, it is entirely plausible that subordinates may have omitted or understated significant deviations from sanctioned mission plans within their official sortie reports, particularly in instances of substantial non-compliance. Additionally, the amount of detail that was recorded within these sortie reports is already quite limited, typically giving us only one or two waypoints across a multi-hour mission. We also only have the plane's general operating data such as cruising speed and altitude and just assumed these for the entire duration of the flight, meaning we assume that the plane flew at a uniform speed from one destination to another; however, in real life, this would be preposterous. For the sake of this project, we do our best with what we have. All of this introduces layers of epistemic uncertainty that must be acknowledged when interpreting both the dataset and our visualization.

Epistemologically, the project rejects the traditional, positivist model of the historian as the sole arbiter of a 'conclusive result.' Instead, it adopts a participatory and mediated epistemology. By utilizing open-source tools (Leaflet) and implementing a CSV upload interface, the platform assumes that historical knowledge is best generated iteratively and communally. Furthermore, by acknowledging the manual corrections required over LLM-parsed data and the necessary blending of 1938 borders with modern basemaps, the project aligns with critical data studies by making its own methodological mediations transparent, presenting the map not as a neutral reflection of the past, but as a visual heuristic designed to catalyze further historical engagement.
Cross-referencing and analyzing general trends in the book The Army Air Forces During World War II, we do have some aspects of the text that our group finds relevant in our digital object. The first aspect comes from watching the time-evolution display of the macroscale map. Across the Pacific, six Numbered Air Forces operated under vastly different conditions, their effectiveness shaped in large part by the distinct personalities and leadership styles of their individual commanders. Unity of command remained elusive throughout the Pacific War, a challenge only compounded by the theater's immense geographic isolation (vol 4 vi-vii). Within our digital object, in the early entry of the United States into the war, we have demarcated the various bases and operations of the Numbered Air Forces. They start scattered wide across the Pacific and a few within the China-India-Burma Theater. Yet by the time the Allies reclaimed Burma in late 1945, a convergence was already underway — aircraft, bases, and broader strategic aims were increasingly oriented toward Japan. Even so, a closer examination of operations at the squadron and group level reveals that each unit remained fundamentally tethered to its own theater, executing missions shaped by the unique geographic and operational demands of its localized region, supporting the idea that there was no general unity across theaters, and the overarching mission was just to defeat Japan without as much coordination and tact as we may have potentially suspected.

“In all, six Army air forces figure in this volume: the Eleventh (North Pacific); the Seventh (Central Pacific); the Thirteenth (South Pacific); the Fifth (Southwest Pacific); the Tenth (IndiaBurma); and the Fourteenth (China). Widely scattered geographically, those several forces operated under varying conditions which, with the character of their respective commanders, tended to mark each with its own individuality. There was no unity of command in the war against Japan, and this lack exaggerated the particularism inherent in geographical isolation. 
Our collective contribution from both ends of the project yielded the significant insight that documented sources had been comprehensively digitized and made publicly accessible. Even at the granular level of charting a single month of operations for the 12th Bombardment Group, our dataset excluded thousands of extant documents. At the archival level, an additional 50,000 bins remained unexamined and available for analysis. In this regard, the scope of our documentation effort is at most modest and should definitely not be overstated. However, the greater significance of this work lies in its potential to catalyze engagement from avid historians, academics, and subject-matter experts who may be inspired to contribute to open-source initiatives and produce rigorous, primary-source documentation of aerial operations drawn directly from original flight logbooks.
Among the most consequential features incorporated into our platform was the implementation of a CSV upload interface, enabling external contributors to supplement the existing dataset with additional flight detail records from the Second World War. While the present study focused exclusively on the Pacific Theater, from which all source data was extracted, the framework is readily extensible to the air campaigns conducted over the European Theater of Operations. Furthermore, as the passage of time continues to facilitate the declassification and improved accessibility of military records, this methodology could reasonably be applied to subsequent conflicts, such as the Korean War, Vietnam War, Gulf War, etc. In conclusion, this project rejects adopting a conclusive result and instead represents a starting point for future documentation and creation of visual heuristics for historical aircraft data.


Basemap unavailable, had to blend modern basemap with 1938 boundaries
You’re absolutely correct: right now it isn’t dynamically swapping modern vector detail by zoom. I’m going to reintroduce a zoom-gated modern minor_islands layer in historical mode so tiny Pacific landmasses appear when zoomed in, while keeping 1938 boundaries/names on top.

	The biggest problem that we ran into while creating this project was deciding the scope and granularity we should take when it came to charting all the routes. During the research phase, we discovered there was a lot of group and squadron data, but it became difficult to find a unified data set. The different groups and squadrons have a relatively well documented history, but creating a project that documented the movement of all the groups and squadrons and each of their sorties across so many different data sources was really ambitious. It was also difficult to find a unified format to create these plans. The next idea we considered was to do individual sorties for a squadron or group. Our group went down to the National Archives in College Park and discovered that for a singular bombardment group from 1941-1945, we would have about 5,000 sorties to chart out. It is here, that we realized we needed to narrow the focus and scope of our project, and we decided to settle for a singular group, with a small timeframe, and include immense granularity in the flight details, the munitions they were carrying, and other information that was relevant to the flight. Similar to flightradar24, we created our interface so that you could click on the aircraft on the map and see the details that were pertinent to that sortie.
	





While conducting our research, we discovered there was a lot of group and squadron data.

Basemap

Create a digital object in ArcGIS vs. choosing to use a flight radar type approach? Why?

Visit to the national archives
College park
Took photos
Searched websites


Website design choices / connect it to what Konrad said in class about making a long-lasting digital artifact → advantages and disadvantages of using Leaflet
W

10610 rows

Basemap
https://github.com/aourednik/historical-basemaps/






Issues – canton island
ELEVENTHAF-19441101-01 – override starting location
Sources for SVG icons 
Required editing in Adobe Illustrator/etc. To convert into svgs 
Done
B-24 Liberator: 3560https://stock.adobe.com/search?k=%22b-24+liberator%22&asset_id=1954844029
B-25 Mitchell: 3208 https://stock.adobe.com/search?k=b25&asset_id=751485733
P-40 Warhawk: 816
https://www.alamy.com/p-40-warhawk-fighter-jet-icon-us-army-symbol-isolated-vector-image-for-military-concepts-infographics-and-web-design-heritage-of-us-air-force-image711258542.html?imageid=89E13838-A7AE-466B-85FC-B354208D84E0&pn=1&searchId=528b30b51b56840632aa6cf59bff2403&searchtype=0
P-38 Lightning: 565 https://www.dreamstime.com/stock-illustration-world-war-ii-lockheed-p-lightning-silhouette-available-vector-format-image92553694?
B-29 Superfortress
Todo

Challenges
Handling flights that wrapped around the date line
Aligning flight paths properly 
Used LLMs to read the text and parse, with artifacts of ocr etc.
Flight times estimated from aircraft type cruising speed/distance
Lots of manual corrections required on top of LLM output (e.g, nanumea)
Complex descriptions —> would involve several missions, involved
Locations that may possibly not be trackable (e.g. Kuanshuishih = ? Guanshui shandong but it it is too far)
Unclear aircraft in the descriptions (FB/fighters/acronyms, have to check the original source to fix? 
Description includes “staging’ through but sometimes base had to be inferred


Small UI details
Made the planes p[roportional to real life size

Limitations
Staging → not handled closely enough by us and unclear since no concrete details in descriptions (e.g. stopping for refueling etc.)
9246 lines when filtered?


To correct List
https://en.wikipedia.org/wiki/Nanumea_Airfield
Aroe Island for FIFTHAF-19430823-01, if data not available don’t assume that it is 1, say something else 

References:
Carter, K. C., & Mueller, R. (1991). The Army Air Forces in World War II: Combat chronology, 1941–1945. Center for Air Force History.


Data





