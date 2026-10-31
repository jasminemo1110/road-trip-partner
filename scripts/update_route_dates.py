"""Update only dates on an existing route, matching stops by order and name."""
import argparse
import datetime
import json
import sqlite3
from pathlib import Path


def update_dates(database, payload):
    expected = payload['stops']
    for stop in expected:
        arrival = datetime.date.fromisoformat(stop['arrival_date'])
        departure = datetime.date.fromisoformat(stop['departure_date'])
        if arrival > departure or arrival.year != payload['year'] or departure.year != payload['year']:
            raise ValueError('Invalid date range')
    if any(a['departure_date'] > b['arrival_date'] for a, b in zip(expected, expected[1:])):
        raise ValueError('Dates must follow route order')
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        backup = str(database) + '.backup-dates-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        with sqlite3.connect(backup) as target:
            connection.backup(target)
        connection.execute('BEGIN IMMEDIATE')
        routes = connection.execute('SELECT * FROM route WHERE name = ?', (payload['name'],)).fetchall()
        if len(routes) != 1 or routes[0]['year'] != payload['year']:
            raise ValueError('Expected one route with matching name and year')
        route_id = routes[0]['id']
        before = [dict(row) for row in connection.execute('SELECT * FROM stop WHERE route_id = ? ORDER BY "order"', (route_id,))]
        if len(before) != len(expected):
            raise ValueError('Stop count changed; refusing update')
        for actual, wanted in zip(before, expected):
            if (actual['order'], actual['city_name']) != (wanted['order'], wanted['city_name']):
                raise ValueError('Stop order or name changed; refusing update')
        for actual, wanted in zip(before, expected):
            connection.execute('UPDATE stop SET arrival_date = ?, departure_date = ? WHERE id = ?',
                               (wanted['arrival_date'], wanted['departure_date'], actual['id']))
        after = [dict(row) for row in connection.execute('SELECT * FROM stop WHERE route_id = ? ORDER BY "order"', (route_id,))]
        for old, new, wanted in zip(before, after, expected):
            assert new['arrival_date'] == wanted['arrival_date'] and new['departure_date'] == wanted['departure_date']
            assert {k: v for k, v in old.items() if k not in ('arrival_date', 'departure_date')} == {
                k: v for k, v in new.items() if k not in ('arrival_date', 'departure_date')}
        connection.commit()
    return {'route_id': route_id, 'stops': len(after), 'backup': backup,
            'start': expected[0]['arrival_date'], 'end': expected[-1]['departure_date']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('payload', type=Path)
    parser.add_argument('--database', type=Path, default=Path(__file__).resolve().parents[1] / 'backend/travel.db')
    args = parser.parse_args()
    print(json.dumps(update_dates(args.database, json.loads(args.payload.read_text())), ensure_ascii=False))
