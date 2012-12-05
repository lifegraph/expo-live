# listen to an arduino over serial port

import serial
import os
import subprocess

arduino = serial.Serial('/dev/tty.usbmodem1411', 57600) # serial port# and baud rate

def post_to_server(queen_id, ant_id):
  subprocess.call(["curl", "-X", "POST", "-d", "hill=" + hill_id, "-d", "ant=" + ant_id, "api.olinexpo.com/hardware"])

prefix = 'Got payload: '
while 1:
  data = arduino.readline().strip()
  pos = data.find(prefix)
  if pos != -1:
    message = data[pos + len(prefix):]
    print "message:", message
    # 8 bytes, each 2 characters big, so make minimum 16 to left pad with appropriate leading 0's
    # these might be reversed
    hill_id = message[0:8]
    ant_id = message[8:]
    print "hill:", hill_id, "ant:", ant_id
    post_to_server(hill_id, ant_id);
    # subprocess.check_output(["echo", "Hello World!"])

