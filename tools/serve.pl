#!/usr/bin/perl
# Servidor estático mínimo para testes locais.
# Uso: perl serve.pl <raiz> <porta> [demo]
# Com "demo", assets/js/config.js é servido vazio (modo demonstração).
use strict; use warnings;
use IO::Socket::INET;
my ($root, $port, $demo) = @ARGV;
my %types = (html => 'text/html; charset=utf-8', js => 'text/javascript; charset=utf-8',
  css => 'text/css; charset=utf-8', svg => 'image/svg+xml', json => 'application/json');
my $srv = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Listen => 20, ReuseAddr => 1)
  or die "listen: $!";
$| = 1; print "Servindo $root em http://localhost:$port/" . ($demo ? " (demo)" : "") . "\n";
while (my $c = $srv->accept) {
  my $line = <$c> // ''; while (my $h = <$c>) { last if $h =~ /^\r?\n$/; }
  my ($path) = $line =~ m{^GET\s+(\S+)};
  $path //= '/'; $path =~ s/[?#].*//; $path =~ s/%([0-9A-Fa-f]{2})/chr hex $1/ge;
  $path = '/index.html' if $path eq '/';
  my ($code, $body, $type) = (404, 'not found', 'text/plain');
  if ($path !~ /\.\./) {
    if ($demo && $path eq '/assets/js/config.js') {
      ($code, $body, $type) = (200, "export const SUPABASE_URL = '';\nexport const SUPABASE_ANON_KEY = '';\n", $types{js});
    } elsif (open my $fh, '<:raw', "$root$path") {
      local $/; $body = <$fh>; close $fh; $code = 200;
      my ($ext) = $path =~ /\.(\w+)$/; $type = $types{$ext // ''} // 'application/octet-stream';
    }
  }
  print $c "HTTP/1.1 $code OK\r\nContent-Type: $type\r\nContent-Length: " . length($body)
    . "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n$body";
  close $c;
}
