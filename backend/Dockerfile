FROM python:3.12-slim                                                                                                                                   
                                                                                                                                                          
WORKDIR /app                                                                                                                                            
                                                                                                                                                          
COPY requirements.txt .                                                                                                                                 
RUN pip install --no-cache-dir -r requirements.txt                                                                                                      

COPY voice_agent ./voice_agent                                                                                                                          
                                                                                                                                                          
WORKDIR /app/voice_agent                                                                                                                                
                                                                                                                                                          
CMD ["python", "agent.py", "start"]   