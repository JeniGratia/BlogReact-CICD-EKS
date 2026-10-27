
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 50, unit: 'MINUTES')
    }

    environment {
        AWS_DEFAULT_REGION = 'ap-south-1'
        AWS_REGION         = 'ap-south-1'
        EKS_CLUSTER        = 'blogapp-eks-cluster'
        APP_NAMESPACE      = 'blogapp'

        ECR_REGISTRY  = '599243103173.dkr.ecr.ap-south-1.amazonaws.com'
        BACKEND_REPO  = '599243103173.dkr.ecr.ap-south-1.amazonaws.com/blogapp-backend'
        FRONTEND_REPO = '599243103173.dkr.ecr.ap-south-1.amazonaws.com/blogapp-frontend'

        NODE_IMAGE   = 'node:20-alpine'
        KUBECTL_PATH = '/var/jenkins_home/tools/bin'
        KUBECONFIG   = "${WORKSPACE}/eks-kubeconfig"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm

                script {
                    def gitSha = sh(
                        returnStdout: true,
                        script: 'git rev-parse --short=7 HEAD'
                    ).trim()

                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${gitSha}"
                }

                echo "Building images with tag: ${IMAGE_TAG}"
            }
        }

        stage('Backend Tests and Lint') {
            steps {
                dir('backend') {
                    sh '''
                        set -eu
                        set +x

                        rm -rf coverage

                        CID=$(docker create -w /app "$NODE_IMAGE" \
                          sh -ec "npm install --no-package-lock --no-audit --no-fund && npm test && npm run lint")

                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$CID":/app
                        docker start -a "$CID"

                        docker cp "$CID":/app/coverage ./coverage
                        test -s coverage/lcov.info

                        echo "Backend tests, lint and coverage report completed."
                    '''
                }
            }
        }

        stage('Frontend Lint and Build') {
            steps {
                dir('frontend') {
                    sh '''
                        set -eu
                        set +x

                        CID=$(docker create -w /app "$NODE_IMAGE" \
                          sh -ec "npm install --no-package-lock --no-audit --no-fund && npm run lint && npm run build")

                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$CID":/app
                        docker start -a "$CID"

                        echo "Frontend lint and build completed."
                    '''
                }
            }
        }

        stage('SonarQube Analysis') {
            steps {
                script {
                    def scannerHome = tool 'SonarScanner'

                    withSonarQubeEnv('SonarQube') {
                        sh """
                            set -eu
                            set +x

                            test -s backend/coverage/lcov.info
                            test -f sonar-project.properties

                            "${scannerHome}/bin/sonar-scanner" \
                              -Dsonar.project.settings=sonar-project.properties
                        """
                    }
                }
            }
        }

        stage('SonarQube Quality Gate') {
            steps {
                timeout(time: 10, unit: 'MINUTES') {
                    script {
                        def qualityGate = waitForQualityGate()

                        echo "SonarQube Quality Gate: ${qualityGate.status}"

                        if (qualityGate.status != 'OK') {
                            error "SonarQube Quality Gate failed: ${qualityGate.status}. Deployment blocked."
                        }
                    }
                }
            }
        }

        stage('Build Docker Images') {
            steps {
                sh '''
                    set -eu
                    set +x

                    echo "Building backend image..."
                    docker build --provenance=false \
                      -t "$BACKEND_REPO:$IMAGE_TAG" ./backend

                    echo "Building frontend image..."
                    docker build --provenance=false \
                      -t "$FRONTEND_REPO:$IMAGE_TAG" ./frontend

                    docker image inspect "$BACKEND_REPO:$IMAGE_TAG" >/dev/null
                    docker image inspect "$FRONTEND_REPO:$IMAGE_TAG" >/dev/null

                    echo "Both images built successfully."
                '''
            }
        }

        stage('Push Images to ECR') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-blogapp-jenkins',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x

                        echo "Checking AWS identity..."
                        aws sts get-caller-identity

                        echo "Logging in to ECR..."
                        aws ecr get-login-password --region "$AWS_REGION" |
                          docker login \
                            --username AWS \
                            --password-stdin "$ECR_REGISTRY"

                        echo "Pushing backend image..."
                        docker push "$BACKEND_REPO:$IMAGE_TAG"

                        echo "Pushing frontend image..."
                        docker push "$FRONTEND_REPO:$IMAGE_TAG"

                        docker logout "$ECR_REGISTRY"

                        echo "Both images pushed successfully."
                    '''
                }
            }
        }

        stage('Configure EKS Access') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-blogapp-jenkins',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x
                        export PATH="$KUBECTL_PATH:$PATH"

                        echo "Checking EKS cluster..."
                        STATUS=$(aws eks describe-cluster \
                          --name "$EKS_CLUSTER" \
                          --region "$AWS_REGION" \
                          --query 'cluster.status' \
                          --output text)

                        echo "EKS status: $STATUS"
                        test "$STATUS" = "ACTIVE"

                        echo "Generating kubeconfig..."
                        aws eks update-kubeconfig \
                          --name "$EKS_CLUSTER" \
                          --region "$AWS_REGION" \
                          --kubeconfig "$KUBECONFIG"

                        echo "Checking Kubernetes access..."
                        kubectl get deployments -n "$APP_NAMESPACE"

                        CAN_PATCH=$(kubectl auth can-i patch deployments \
                          -n "$APP_NAMESPACE")

                        echo "Can patch deployments: $CAN_PATCH"
                        test "$CAN_PATCH" = "yes"
                    '''
                }
            }
        }

        stage('Deploy to EKS') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-blogapp-jenkins',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x
                        export PATH="$KUBECTL_PATH:$PATH"

                        echo "Updating backend..."
                        kubectl set image deployment/backend \
                          backend="$BACKEND_REPO:$IMAGE_TAG" \
                          -n "$APP_NAMESPACE"

                        echo "Updating frontend..."
                        kubectl set image deployment/frontend \
                          frontend="$FRONTEND_REPO:$IMAGE_TAG" \
                          -n "$APP_NAMESPACE"

                        echo "Image updates submitted."
                    '''
                }
            }
        }

        stage('Verify Deployment') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-blogapp-jenkins',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x
                        export PATH="$KUBECTL_PATH:$PATH"

                        echo "Waiting for backend rollout..."
                        kubectl rollout status deployment/backend \
                          -n "$APP_NAMESPACE" --timeout=240s

                        echo "Waiting for frontend rollout..."
                        kubectl rollout status deployment/frontend \
                          -n "$APP_NAMESPACE" --timeout=240s

                        echo "Deployments:"
                        kubectl get deployments -n "$APP_NAMESPACE"

                        echo "Pods:"
                        kubectl get pods -n "$APP_NAMESPACE"

                        echo "Services:"
                        kubectl get services -n "$APP_NAMESPACE"

                        echo "Deployment verification completed."
                    '''
                }
            }
        }
    }

    post {
        success {
            echo "CI/CD succeeded. Image tag: ${IMAGE_TAG}"
        }

        failure {
            echo 'Pipeline failed. Check the first failing stage in Console Output.'
        }

        always {
            sh 'rm -f "$KUBECONFIG" || true'
            echo 'Pipeline finished.'
        }
    }
}
