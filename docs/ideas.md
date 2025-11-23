We could move to a web based configuration at this point, since we are using
sqlite to store index data...

Pros:

- This would remove all need for environment variables, making install very easy
  for everyone..
- Easily add and remove indexers with a click of a mouse
- Would not need to restart the app everytime I change an env... easier for
  development..

Cons:

- Tons more code
- Would need some type of auth.. or maybe just require the use of tailscale...
  No that would be another dependency.
- Increased package size, including dependancies
- The commandline tool works well already..
- Usually you set it and forget it, so using the command line tool once is not
  such a big deal.
