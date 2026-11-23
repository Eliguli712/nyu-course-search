# PLAN

This repository implements NYU course search based on course name and description.

All courses at NYU are available at https://bulletins.nyu.edu/courses/.
The first step is to scrape all courses and store them in a database.

Each course must be embedded in an Euclidean space using Nomic embedding
from HuggingFace model hub. This allows us to perform vector similarity search
based on semantics. This search must be implemented using a web UI.

Unfortunately, this course listing has only the course code, name and description.
In order to get the detail, we must use the course search tool (beta) at
https://bulletins.nyu.edu/class-search/. This course search tool returns more
details about the course. Instead of scraping this page, we should be able to
use this search page (everything is passed as query parameters) and display
details in the web UI. Some courses do not open in all semesters, and we should
try all semesters within the same year to get the details. If the course is not
found, we should try going back in time one semester at a time.

The whole thing should be doable from the web UI. The web UI must be professional
and modern. Furthermore, this web UI should support multiple users, as we want
users to save the courses they searched for so that they can plan out their future
courses. For each retrieved course, we need a thumb-up feature, so that we track
the relevance of each course to the query.

Because we may want to deploy this app to Railway, we should use Postgres and
Redis for caching. We also need a web framework that is easy to deploy to Railway
and easy to debug and maintain. For users, we should only allow those with
@nyu.edu email addresses to use this app.
