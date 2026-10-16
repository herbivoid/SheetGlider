"""Start SheetGlider:  python run.py   (then use the page that opens in your browser)"""
import argparse
import threading
import webbrowser

from sheetglider.server import serve


def main():
    parser = argparse.ArgumentParser(description="SheetGlider local app")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()

    server, port = serve(args.port)
    url = f"http://127.0.0.1:{port}/app/"
    if port != args.port:
        print(f"Port {args.port} is busy (is SheetGlider already running?), so using {port}.", flush=True)
    print(f"SheetGlider running at {url}  (Ctrl+C to stop)", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
