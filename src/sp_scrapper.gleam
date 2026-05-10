import gleam/http/request
import gleam/httpc
import gleam/io
import gleam/list
import gleam/option.{None, Some}
import gleam/regexp.{type Match}
import gleam/string

const url = "https://south-park-tv.fr/"

const season_url_pattern = url <> "saison-"

pub fn main() {
  // Build the request
  let assert Ok(r) = request.to(url)

  let req =
    r
    |> request.set_header("user-agent", "Mozilla/5.0")
    |> request.set_header("accept", "text/html")

  // Send it
  let assert Ok(resp) = httpc.send(req)

  let links = get_season_links(resp.body)
}

fn get_season_links(html: String) -> List(#(String, String)) {
  let assert Ok(link_re) = regexp.from_string("href=\"([^\"]+)\"")

  let res =
    regexp.scan(link_re, html)
    |> list.filter_map(parse_match)
    |> list.flatten()
    |> list.unique()
    |> list.filter_map(add_season_name)
}

fn add_season_name(url: String) -> Result(#(String, String), Nil) {
  let assert Ok(re) = regexp.from_string("saison-\\d+")
  case regexp.scan(re, url) {
    [scanned, ..] -> {
      case scanned.content {
        "" -> Error(Nil)
        name -> Ok(#(name, url))
      }
    }
    [] -> Error(Nil)
  }
}

fn parse_match(match: Match) -> Result(List(String), Nil) {
  let filtered_urls =
    list.filter_map(match.submatches, fn(sub) {
      case sub {
        Some(url) -> {
          case
            string.starts_with(url, season_url_pattern)
            && !string.contains(url, "episode-")
          {
            True -> Ok(url)
            False -> Error(Nil)
          }
        }
        None -> Error(Nil)
      }
    })

  Ok(filtered_urls)
}

fn matches_pattern(link: String) -> Bool {
  string.starts_with(link, "/articles/")
  // change this to your pattern
}
