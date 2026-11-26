#include <sys/socket.h>
#include <netinet/in.h>
#include <sys/time.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc,char **argv) {
 int af=argc>1&&atoi(argv[1])==6?AF_INET6:AF_INET;
 int fd=socket(af,SOCK_DGRAM,0); if(fd<0){perror("socket");return 1;}
 struct timeval tv={3,0}; setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&tv,sizeof(tv));
 struct sockaddr_storage ss={0}; socklen_t len;
 if(af==AF_INET){struct sockaddr_in *s=(void*)&ss;s->sin_family=af;s->sin_port=htons(65100);s->sin_addr.s_addr=htonl(INADDR_LOOPBACK);len=sizeof(*s);}
 else{struct sockaddr_in6 *s=(void*)&ss;s->sin6_family=af;s->sin6_port=htons(65100);s->sin6_addr=in6addr_loopback;len=sizeof(*s);}
 if(bind(fd,(void*)&ss,len)){perror("bind");return 1;}
 const char msg[]="Chester-K45P-NFQUEUE-roundtrip";char buf[128];
 if(sendto(fd,msg,sizeof(msg),0,(void*)&ss,len)!=sizeof(msg)){perror("sendto");return 1;}
 int n=recv(fd,buf,sizeof(buf),0);
 if(n!=sizeof(msg)||memcmp(buf,msg,sizeof(msg))){perror("roundtrip");return 1;}
 printf("IPv%d NFQUEUE roundtrip PASS (%d bytes)\n",af==AF_INET?4:6,n);close(fd);return 0;
}
