# listen to an arduino over serial port

import serial, json
import os
import subprocess

arduino = serial.Serial('/dev/tty.usbmodem1411', 57600) # serial port# and baud rate

def chunks(l, n):
  return [l[i:i+n] for i in range(0, len(l), n)]

def post_to_server(queen_id, ant_id):
  subprocess.call(["curl", "-X", "POST", "-d", "colony=" + colony_id, "-d", "ant=" + ant_id, "api.olinexpo.com/hardware"])

prefix = 'Got payload: '
while 1:
  data = arduino.readline().strip()
  pos = data.find(prefix)
  if pos != -1:
    message = data[pos + len(prefix):]
    print "message:", json.dumps(message)
    # 8 bytes, each 2 characters big, so make minimum 16 to left pad with appropriate leading 0's
    # these might be reversed
    colony_id = message[0:8]
    ant_id = message[8:]

    # Revert to small-endian.
    colony_id = ''.join(chunks(colony_id, 2).reverse())
    ant_id = ''.join(chunks(ant_id, 2).reverse())

    # POST that biznatch
    print "colony:", json.dumps(colony_id), "ant:", json.dumps(ant_id)
    post_to_server(colony_id, ant_id);
    # subprocess.check_output(["echo", "Hello World!"])
